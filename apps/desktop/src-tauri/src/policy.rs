//! Fail-closed policy classification shared by terminal and future Tool Gateway calls.
//!
//! Design (goal: safer agent defaults):
//! - Known inspection / project-check argv → AllowOnce inside the workspace.
//! - Shells, interpreters, package-script runners, network, containers, and
//!   destructive tools → RequireConfirmation (or Deny for sensitive paths).
//! - Unknown programs default to confirmation rather than silent allow.

use crate::platform::{ActionEffect, ActionRequest, PolicyDecision, PolicyDecisionKind, RiskLevel};
use std::path::{Component, Path, PathBuf};

pub struct TerminalActionInput<'a> {
    pub request_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub command: &'a str,
    pub args: &'a [String],
    pub secret_refs: Vec<String>,
    pub strict_terminal: bool,
}

pub fn classify_terminal_action(
    request_id: String,
    workspace_id: String,
    task_id: String,
    session_id: String,
    command: &str,
    args: &[String],
    secret_refs: Vec<String>,
) -> ActionRequest {
    classify_terminal_action_with_options(TerminalActionInput {
        request_id,
        workspace_id,
        task_id,
        session_id,
        command,
        args,
        secret_refs,
        strict_terminal: false,
    })
}

pub fn classify_terminal_action_with_options(input: TerminalActionInput<'_>) -> ActionRequest {
    let TerminalActionInput {
        request_id,
        workspace_id,
        task_id,
        session_id,
        command,
        args,
        secret_refs,
        strict_terminal,
    } = input;
    let program = program_name(command);
    let paths = classify_terminal_paths(Path::new(&workspace_id), args);
    let mut effect = ActionEffect::Execute;
    let mut risk = RiskLevel::Low;

    if is_shell_program(&program)
        || is_interpreter_invocation(&program, args)
        || is_command_wrapper(&program)
        || is_script_package_runner(&program, args)
        || is_build_orchestrator(&program)
    {
        risk = RiskLevel::High;
    }
    if is_network_program(&program)
        || is_git_network_operation(&program, args)
        || is_package_install(&program, args)
        || is_cloud_cli(&program)
    {
        effect = ActionEffect::Network;
        risk = RiskLevel::High;
    }
    if is_external_side_effect(&program, args) || is_container_or_orchestrator(&program) {
        effect = ActionEffect::ExternalSideEffect;
        risk = RiskLevel::Critical;
    }
    if is_destructive_git(&program, args)
        || is_destructive_filesystem_command(&program)
        || is_privilege_escalation(&program)
    {
        effect = ActionEffect::Destructive;
        risk = RiskLevel::Critical;
    }

    // Known-safe project checks stay low risk even when the program name is
    // shared with higher-risk package tooling (e.g. cargo test vs cargo install).
    // Strict terminal mode only auto-allows pure inspection tools.
    if is_known_safe_project_check(&program, args, strict_terminal) {
        risk = RiskLevel::Low;
        effect = ActionEffect::Execute;
    } else if strict_terminal && matches!(risk, RiskLevel::Low) {
        // Fail closed: anything that is not pure inspection needs a click.
        risk = RiskLevel::High;
    }

    ActionRequest {
        request_id,
        actor: "runtime:grok-acp".into(),
        workspace_id,
        task_id,
        session_id,
        tool: "terminal.create".into(),
        effect,
        argv: std::iter::once(command.to_string())
            .chain(args.iter().cloned())
            .collect(),
        paths,
        network_targets: vec![],
        secret_refs,
        risk,
        deadline: crate::acp::iso_now(),
        metadata: Default::default(),
    }
}

fn program_name(command: &str) -> String {
    Path::new(command)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase()
}

/// Extract argv entries that can address the filesystem, resolving relative
/// paths against the terminal workspace. This makes the policy evaluate what a
/// child process can actually read, rather than assuming its cwd is a sandbox.
fn classify_terminal_paths(workspace_root: &Path, args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    for argument in args {
        let Some(path) = terminal_path_argument(argument) else {
            continue;
        };
        let resolved = resolve_terminal_path(workspace_root, path);
        let resolved = resolved.to_string_lossy().into_owned();
        if !paths.contains(&resolved) {
            paths.push(resolved);
        }
    }
    paths
}

fn terminal_path_argument(argument: &str) -> Option<&str> {
    let argument = argument.trim();
    let candidate = argument
        .split_once('=')
        .filter(|(flag, _)| flag.starts_with('-'))
        .map(|(_, value)| value)
        .unwrap_or(argument)
        .trim();
    if candidate.is_empty() || candidate.contains("://") {
        return None;
    }
    let path = Path::new(candidate);
    let path_like = path.is_absolute()
        || matches!(candidate, "." | ".." | "~")
        || candidate.starts_with("./")
        || candidate.starts_with("../")
        || candidate.starts_with("~/")
        || candidate.contains('/')
        || candidate.contains('\\');
    path_like.then_some(candidate)
}

fn resolve_terminal_path(workspace_root: &Path, candidate: &str) -> PathBuf {
    let expanded = crate::acp::shellexpand_home(candidate);
    let candidate = PathBuf::from(expanded);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        workspace_root.join(candidate)
    };
    let lexical = normalize_lexical(&candidate);
    std::fs::canonicalize(&lexical).unwrap_or(lexical)
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(Component::RootDir.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(component) => out.push(component),
        }
    }
    out
}

fn path_is_outside_workspace(path: &Path, workspace_root: &Path) -> bool {
    let root =
        std::fs::canonicalize(workspace_root).unwrap_or_else(|_| normalize_lexical(workspace_root));
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| normalize_lexical(path));
    !path.starts_with(&root)
}

/// Return true when `requested` falls under any task `allowed_paths` entry.
/// Empty `allowed_paths` means unrestricted (caller decides).
pub fn path_matches_allowed(
    workspace_root: &Path,
    requested: &str,
    allowed_paths: &[String],
) -> bool {
    if allowed_paths.is_empty() {
        return true;
    }
    let requested = normalize_task_path(workspace_root, requested);
    allowed_paths.iter().any(|allowed| {
        let allowed = normalize_task_path(workspace_root, allowed);
        requested == allowed || requested.starts_with(&allowed)
    })
}

fn normalize_task_path(workspace_root: &Path, raw: &str) -> PathBuf {
    let expanded = crate::acp::shellexpand_home(raw.trim());
    let path = PathBuf::from(&expanded);
    let joined = if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    };
    let lexical = normalize_lexical(&joined);
    std::fs::canonicalize(&lexical).unwrap_or(lexical)
}

/// Automatic verification never starts a shell or command wrapper. A declared
/// shell command would otherwise wait for input and could execute arbitrary
/// content after a turn completes.
pub fn automatic_verification_allows(command: &str, args: &[String]) -> bool {
    let programs = std::iter::once(command).chain(args.iter().map(String::as_str));
    !programs
        .map(program_name)
        .any(|program| is_shell_program(&program) || is_automatic_command_wrapper(&program))
}

fn is_shell_program(program: &str) -> bool {
    matches!(
        program,
        "sh" | "bash"
            | "zsh"
            | "fish"
            | "dash"
            | "ksh"
            | "csh"
            | "tcsh"
            | "ash"
            | "cmd"
            | "cmd.exe"
            | "pwsh"
            | "powershell"
    )
}

fn is_automatic_command_wrapper(program: &str) -> bool {
    matches!(
        program,
        "env"
            | "command"
            | "busybox"
            | "toybox"
            | "sudo"
            | "doas"
            | "xargs"
            | "nohup"
            | "nice"
            | "timeout"
            | "setsid"
            | "stdbuf"
    )
}

fn is_command_wrapper(program: &str) -> bool {
    is_automatic_command_wrapper(program)
}

pub fn evaluate(action: &ActionRequest) -> PolicyDecision {
    evaluate_with_allowed_paths(action, &[])
}

/// Evaluate policy, optionally elevating risk when terminal paths leave the
/// task's allowed modification scope (non-empty `allowed_paths` only).
pub fn evaluate_with_allowed_paths(
    action: &ActionRequest,
    allowed_paths: &[String],
) -> PolicyDecision {
    let workspace_root = Path::new(&action.workspace_id);
    let outside_allowed = !allowed_paths.is_empty()
        && action
            .paths
            .iter()
            .any(|path| !path_matches_allowed(workspace_root, path, allowed_paths));

    let (decision, reason, second) = if action.paths.iter().any(|path| {
        let path = Path::new(path);
        is_sensitive_path(path) && path_is_outside_workspace(path, workspace_root)
    }) {
        (
            PolicyDecisionKind::Deny,
            "Sensitive paths are outside the workspace capability".to_string(),
            false,
        )
    } else if action
        .paths
        .iter()
        .any(|path| path_is_outside_workspace(Path::new(path), workspace_root))
    {
        (
            PolicyDecisionKind::RequireConfirmation,
            "Terminal path is outside the workspace and requires confirmation".into(),
            false,
        )
    } else if outside_allowed {
        (
            PolicyDecisionKind::RequireConfirmation,
            "Terminal path is outside the task allowed paths and requires confirmation".into(),
            false,
        )
    } else if matches!(action.risk, RiskLevel::Critical) {
        (
            PolicyDecisionKind::RequireConfirmation,
            "Destructive or externally visible action requires a second confirmation".into(),
            true,
        )
    } else if matches!(action.risk, RiskLevel::High)
        || matches!(
            action.effect,
            ActionEffect::Network | ActionEffect::ExternalSideEffect
        )
    {
        (
            PolicyDecisionKind::RequireConfirmation,
            "Shell, interpreter, package script, network, or elevated tool requires confirmation"
                .into(),
            false,
        )
    } else {
        (
            PolicyDecisionKind::AllowOnce,
            "Action is an argv-only workspace-scoped command".into(),
            false,
        )
    };

    PolicyDecision {
        request_id: action.request_id.clone(),
        decision,
        decided_at: crate::acp::iso_now(),
        reason,
        matched_rule_ids: vec!["platform:default-fail-closed-v2".into()],
        requires_second_confirmation: second,
    }
}

/// Interpreters can run arbitrary files without `-c`; treat any non-metadata
/// invocation as high risk.
fn is_interpreter_invocation(program: &str, args: &[String]) -> bool {
    if !matches!(
        program,
        "python"
            | "python3"
            | "python2"
            | "node"
            | "nodejs"
            | "ruby"
            | "perl"
            | "php"
            | "lua"
            | "deno"
            | "bun"
            | "osascript"
            | "swift"
            | "julia"
            | "R"
            | "r"
            | "Rscript"
    ) {
        // `bun` is both a package manager and a JS runtime; package cases are
        // covered separately. Treat bare `bun <file>` via package runner checks.
        return false;
    }
    if args.is_empty() {
        return true;
    }
    if args.iter().all(|arg| is_metadata_only_flag(arg)) {
        return false;
    }
    true
}

fn is_metadata_only_flag(arg: &str) -> bool {
    matches!(
        arg,
        "--version" | "-V" | "-v" | "--help" | "-h" | "version" | "help"
    )
}

/// `npm run`, `yarn start`, etc. execute arbitrary project scripts.
fn is_script_package_runner(program: &str, args: &[String]) -> bool {
    let sub = args.first().map(String::as_str);
    match program {
        "npm" | "pnpm" | "yarn" | "bun" => matches!(
            sub,
            Some("run" | "start" | "stop" | "restart" | "test" | "exec" | "dlx" | "x" | "create")
        ),
        "npx" => true,
        _ => false,
    }
}

fn is_build_orchestrator(program: &str) -> bool {
    matches!(
        program,
        "make" | "gmake" | "cmake" | "ninja" | "bazel" | "buck" | "buck2" | "just" | "task"
    )
}

fn is_privilege_escalation(program: &str) -> bool {
    matches!(program, "sudo" | "doas" | "su" | "pkexec")
}

fn is_container_or_orchestrator(program: &str) -> bool {
    matches!(
        program,
        "docker"
            | "podman"
            | "nerdctl"
            | "kubectl"
            | "helm"
            | "minikube"
            | "kind"
            | "container"
            | "lima"
            | "colima"
    )
}

fn is_cloud_cli(program: &str) -> bool {
    matches!(
        program,
        "aws" | "gcloud" | "az" | "oci" | "flyctl" | "fly" | "vercel" | "netlify" | "heroku"
    )
}

/// Project-local checks the agent should run freely inside the workspace.
/// When `strict` is true, only pure inspection tools auto-allow (no test runners).
fn is_known_safe_project_check(program: &str, args: &[String], strict: bool) -> bool {
    let sub = args.first().map(String::as_str);
    let pure_inspection = matches!(
        program,
        "rg" | "grep"
            | "ag"
            | "ack"
            | "fd"
            | "find"
            | "ls"
            | "cat"
            | "head"
            | "tail"
            | "wc"
            | "file"
            | "which"
            | "whereis"
            | "pwd"
            | "true"
            | "false"
            | "date"
            | "uname"
            | "stat"
            | "diff"
            | "cmp"
            | "md5"
            | "md5sum"
            | "shasum"
            | "sha256sum"
            | "sort"
            | "uniq"
            | "cut"
            | "tr"
            | "echo"
            | "printf"
            | "basename"
            | "dirname"
            | "realpath"
            | "readlink"
            | "jq"
            | "yq"
            | "tree"
            | "hexdump"
            | "xxd"
            | "nl"
            | "tac"
            | "less"
            | "more"
    ) || (program == "git"
        && matches!(
            sub,
            Some(
                "status"
                    | "diff"
                    | "log"
                    | "show"
                    | "branch"
                    | "rev-parse"
                    | "ls-files"
                    | "blame"
                    | "describe"
            )
        )
        && !args
            .iter()
            .any(|a| matches!(a.as_str(), "--hard" | "-D" | "--force" | "-f" | "--delete")));

    if strict {
        return pure_inspection
            || (program == "cargo"
                && matches!(
                    sub,
                    Some("tree" | "metadata" | "version" | "-V" | "--version")
                ));
    }

    pure_inspection
        || match program {
            "cargo" => {
                matches!(
                    sub,
                    Some(
                        "test"
                            | "check"
                            | "clippy"
                            | "build"
                            | "fmt"
                            | "tree"
                            | "metadata"
                            | "nextest"
                    )
                ) && !args.iter().any(|a| a == "--" || a.starts_with("--eval"))
            }
            "git" => {
                matches!(sub, Some("tag" | "remote" | "config"))
                    && !args.iter().any(|a| {
                        matches!(a.as_str(), "--hard" | "-D" | "--force" | "-f" | "--delete")
                    })
            }
            "rustc" | "rustfmt" | "clippy-driver" => args.iter().all(|a| {
                is_metadata_only_flag(a)
                    || a.starts_with("--print")
                    || a == "--version"
                    || a == "-V"
            }),
            "tsc" | "eslint" | "prettier" | "vitest" | "jest" | "mocha" | "pytest" | "pyright"
            | "mypy" | "ruff" | "black" | "go" => match program {
                "go" => matches!(
                    sub,
                    Some("test" | "vet" | "fmt" | "list" | "env" | "version")
                ),
                "vitest" | "jest" | "mocha" | "pytest" => true,
                "tsc" | "eslint" | "prettier" | "pyright" | "mypy" | "ruff" | "black" => true,
                _ => false,
            },
            "swift" => {
                matches!(sub, Some("test" | "build" | "package"))
                    || args.iter().any(|a| a == "--version" || a == "-version")
            }
            "xcodebuild" => args
                .iter()
                .all(|a| matches!(a.as_str(), "-version" | "-showsdks" | "-list" | "-help")),
            "npm" | "pnpm" | "yarn" => matches!(
                sub,
                Some("test" | "ls" | "list" | "view" | "outdated" | "pack" | "explain" | "why")
            ),
            _ => false,
        }
}

/// Review/summary handoff artifacts must stay under workspace `.grok/scratch/`.
pub fn handoff_write_allowed(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    let file_name = Path::new(&normalized)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let is_handoff = matches!(file_name, "summary.md" | "review.md");
    if !is_handoff {
        return true;
    }
    normalized.contains("/.grok/scratch/") || normalized.starts_with(".grok/scratch/")
}

fn is_network_program(program: &str) -> bool {
    matches!(
        program,
        "curl"
            | "wget"
            | "http"
            | "httpie"
            | "aria2c"
            | "ssh"
            | "scp"
            | "sftp"
            | "rsync"
            | "nc"
            | "netcat"
            | "ncat"
            | "socat"
            | "ftp"
            | "telnet"
            | "fetch"
            | "axel"
            | "lftp"
            | "smbclient"
    )
}

fn is_git_network_operation(program: &str, args: &[String]) -> bool {
    program == "git"
        && matches!(
            args.first().map(String::as_str),
            Some("clone" | "fetch" | "pull" | "ls-remote" | "submodule" | "push")
        )
}

fn is_package_install(program: &str, args: &[String]) -> bool {
    let subcommand = args.first().map(String::as_str);
    match program {
        "npm" | "pnpm" | "yarn" | "bun" => matches!(
            subcommand,
            Some("install" | "i" | "ci" | "add" | "update" | "upgrade" | "exec" | "dlx")
        ),
        "pip" | "pip3" | "poetry" | "uv" | "gem" | "bundle" | "composer" => {
            matches!(subcommand, Some("install" | "add" | "update" | "upgrade"))
        }
        "cargo" => matches!(subcommand, Some("install" | "add" | "update")),
        "go" => matches!(subcommand, Some("get" | "install")),
        "brew" | "apt" | "apt-get" | "yum" | "dnf" | "pacman" | "apk" => true,
        _ => false,
    }
}

fn is_external_side_effect(program: &str, args: &[String]) -> bool {
    (program == "npm" && args.first().map(String::as_str) == Some("publish"))
        || (program == "cargo" && args.first().map(String::as_str) == Some("publish"))
        || (program == "gh"
            && matches!(
                args.first().map(String::as_str),
                Some("pr" | "release" | "workflow" | "api" | "gist")
            ))
        || (program == "git"
            && args.first().map(String::as_str) == Some("push")
            && args
                .iter()
                .any(|a| matches!(a.as_str(), "--force" | "-f" | "--force-with-lease")))
        || matches!(program, "open" | "xdg-open" | "gio")
}

fn is_destructive_git(program: &str, args: &[String]) -> bool {
    if program != "git" {
        return false;
    }
    match args.first().map(String::as_str) {
        Some("push" | "clean") => true,
        Some("reset") => args.iter().any(|arg| arg == "--hard"),
        Some("branch") => args.iter().any(|arg| arg == "-D"),
        Some("checkout" | "restore") => args.iter().any(|arg| arg == "--"),
        Some("rebase" | "filter-branch" | "filter-repo") => true,
        _ => false,
    }
}

fn is_destructive_filesystem_command(program: &str) -> bool {
    matches!(
        program,
        "rm" | "rmdir"
            | "unlink"
            | "dd"
            | "truncate"
            | "shred"
            | "chmod"
            | "chown"
            | "chgrp"
            | "mv"
            | "wipefs"
    ) || program.starts_with("mkfs")
}

fn is_sensitive_path(path: &Path) -> bool {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    normalized
        .split('/')
        .any(|segment| matches!(segment, ".ssh" | ".aws" | ".gnupg" | ".azure" | ".kube"))
        || [
            "/.grok/auth",
            "/.config/gcloud/",
            "/library/keychains/",
            "/library/application support/google/chrome/",
            "/library/application support/firefox/",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(command: &str, args: &[&str]) -> ActionRequest {
        classify_terminal_action(
            "r1".into(),
            "/workspace".into(),
            "t1".into(),
            "s1".into(),
            command,
            &args
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>(),
            vec![],
        )
    }

    #[test]
    fn allows_argv_only_local_command() {
        let decision = evaluate(&action("cargo", &["test"]));
        assert_eq!(decision.decision, PolicyDecisionKind::AllowOnce);
        assert_eq!(
            evaluate(&action("git", &["status"])).decision,
            PolicyDecisionKind::AllowOnce
        );
        assert_eq!(
            evaluate(&action("rg", &["TODO", "src"])).decision,
            PolicyDecisionKind::AllowOnce
        );
    }

    #[test]
    fn automatic_verification_never_starts_a_shell() {
        assert!(!automatic_verification_allows("/bin/zsh", &["-l".into()]));
        assert!(!automatic_verification_allows(
            "env",
            &["bash".into(), "-c".into()]
        ));
        assert!(!automatic_verification_allows(
            "busybox",
            &["sh".into(), "-c".into()]
        ));
        assert!(automatic_verification_allows("cargo", &["test".into()]));
    }

    #[test]
    fn shell_inline_network_and_destructive_git_require_confirmation() {
        for request in [
            action("sh", &["-c", "echo hi"]),
            action("zsh", &["-lc", "echo hi"]),
            action("curl", &["https://example.com"]),
            action("git", &["reset", "--hard"]),
            action("git", &["clone", "https://example.com/repo.git"]),
            action("npm", &["install"]),
            action("rm", &["-rf", "build-output"]),
            action("truncate", &["-s", "0", "database.sqlite"]),
        ] {
            assert_eq!(
                evaluate(&request).decision,
                PolicyDecisionKind::RequireConfirmation
            );
        }
    }

    #[test]
    fn script_and_interpreter_runners_require_confirmation() {
        for request in [
            action("bash", &["./hack.sh"]),
            action("zsh", &["script.zsh"]),
            action("python3", &["evil.py"]),
            action("node", &["tool.js"]),
            action("npm", &["run", "build"]),
            action("npx", &["eslint", "."]),
            action("make", &["all"]),
            action("docker", &["run", "alpine"]),
            action("osascript", &["-e", "display dialog \"x\""]),
            action("sudo", &["id"]),
        ] {
            assert_eq!(
                evaluate(&request).decision,
                PolicyDecisionKind::RequireConfirmation,
                "expected confirmation for {:?}",
                request.argv
            );
        }
    }

    #[test]
    fn terminal_paths_are_checked_before_an_argv_only_command_is_allowed() {
        for request in [
            action("cat", &["/Users/example/.ssh/id_rsa"]),
            action("cat", &["--credentials=/Users/example/.aws/credentials"]),
            action("cat", &["/Users/example/.grok/auth/token.json"]),
        ] {
            assert_eq!(evaluate(&request).decision, PolicyDecisionKind::Deny);
        }

        assert_eq!(
            evaluate(&action("cat", &["../outside.txt"])).decision,
            PolicyDecisionKind::RequireConfirmation
        );
        assert_eq!(
            evaluate(&action("cat", &["src/main.rs"])).decision,
            PolicyDecisionKind::AllowOnce
        );
    }

    #[test]
    fn allowed_paths_elevate_out_of_scope_terminal_paths() {
        let request = action("cat", &["other/module.rs"]);
        let decision = evaluate_with_allowed_paths(&request, &["apps/desktop".into()]);
        assert_eq!(decision.decision, PolicyDecisionKind::RequireConfirmation);
        assert!(decision.reason.contains("allowed paths"));

        let in_scope = action("cat", &["apps/desktop/src/main.rs"]);
        let decision = evaluate_with_allowed_paths(&in_scope, &["apps/desktop".into()]);
        assert_eq!(decision.decision, PolicyDecisionKind::AllowOnce);
    }

    #[test]
    fn path_matches_allowed_handles_relative_prefixes() {
        let root = Path::new("/workspace");
        assert!(path_matches_allowed(
            root,
            "apps/desktop/src/a.rs",
            &["apps/desktop".into()]
        ));
        assert!(!path_matches_allowed(
            root,
            "apps/desktop-evil/a.rs",
            &["apps/desktop".into()]
        ));
        assert!(!path_matches_allowed(
            root,
            "other/a.rs",
            &["apps/desktop".into()]
        ));
    }

    #[test]
    fn strict_terminal_requires_confirmation_for_project_tests() {
        let open = classify_terminal_action_with_options(TerminalActionInput {
            request_id: "r1".into(),
            workspace_id: "/workspace".into(),
            task_id: "t1".into(),
            session_id: "s1".into(),
            command: "cargo",
            args: &["test".into()],
            secret_refs: vec![],
            strict_terminal: false,
        });
        assert_eq!(evaluate(&open).decision, PolicyDecisionKind::AllowOnce);

        let strict = classify_terminal_action_with_options(TerminalActionInput {
            request_id: "r1".into(),
            workspace_id: "/workspace".into(),
            task_id: "t1".into(),
            session_id: "s1".into(),
            command: "cargo",
            args: &["test".into()],
            secret_refs: vec![],
            strict_terminal: true,
        });
        assert_eq!(
            evaluate(&strict).decision,
            PolicyDecisionKind::RequireConfirmation
        );
        assert_eq!(
            evaluate(&action("rg", &["TODO"])).decision,
            PolicyDecisionKind::AllowOnce
        );
    }

    #[test]
    fn handoff_writes_must_stay_under_scratch() {
        assert!(handoff_write_allowed(".grok/scratch/abc/summary.md"));
        assert!(handoff_write_allowed("/ws/.grok/scratch/run/review.md"));
        assert!(handoff_write_allowed("src/main.rs"));
        assert!(!handoff_write_allowed("summary.md"));
        assert!(!handoff_write_allowed("/tmp/review.md"));
        assert!(!handoff_write_allowed(".grok/summary.md"));
    }
}
