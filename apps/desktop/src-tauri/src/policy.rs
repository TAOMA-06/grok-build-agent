//! Fail-closed policy classification shared by terminal and future Tool Gateway calls.

use crate::platform::{ActionEffect, ActionRequest, PolicyDecision, PolicyDecisionKind, RiskLevel};
use std::path::{Component, Path, PathBuf};

pub fn classify_terminal_action(
    request_id: String,
    workspace_id: String,
    task_id: String,
    session_id: String,
    command: &str,
    args: &[String],
    secret_refs: Vec<String>,
) -> ActionRequest {
    let program = program_name(command);
    let paths = classify_terminal_paths(Path::new(&workspace_id), args);
    let mut effect = ActionEffect::Execute;
    let mut risk = RiskLevel::Low;

    if is_shell_wrapper(&program, args) || is_inline_interpreter(&program, args) {
        risk = RiskLevel::High;
    }
    if is_network_program(&program)
        || is_git_network_operation(&program, args)
        || is_package_install(&program, args)
    {
        effect = ActionEffect::Network;
        risk = RiskLevel::High;
    }
    if is_external_side_effect(&program, args) {
        effect = ActionEffect::ExternalSideEffect;
        risk = RiskLevel::Critical;
    }
    if is_destructive_git(&program, args) || is_destructive_filesystem_command(&program) {
        effect = ActionEffect::Destructive;
        risk = RiskLevel::Critical;
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
    !path.starts_with(root)
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

pub fn evaluate(action: &ActionRequest) -> PolicyDecision {
    let workspace_root = Path::new(&action.workspace_id);
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
            "Shell indirection, interpreter code, or network access requires confirmation".into(),
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
        matched_rule_ids: vec!["platform:default-fail-closed-v1".into()],
        requires_second_confirmation: second,
    }
}

fn is_shell_wrapper(program: &str, args: &[String]) -> bool {
    if !is_shell_program(program) {
        return false;
    }
    match program {
        "sh" | "bash" | "zsh" | "fish" => args.iter().any(|arg| {
            arg.strip_prefix('-')
                .is_some_and(|flags| flags.contains('c'))
        }),
        "cmd" | "cmd.exe" => args.iter().any(|arg| arg.eq_ignore_ascii_case("/c")),
        "pwsh" | "powershell" => args
            .iter()
            .any(|arg| arg.eq_ignore_ascii_case("-command") || arg.eq_ignore_ascii_case("-c")),
        _ => false,
    }
}

fn is_inline_interpreter(program: &str, args: &[String]) -> bool {
    matches!(
        program,
        "python" | "python3" | "node" | "ruby" | "perl" | "php"
    ) && args
        .iter()
        .any(|arg| matches!(arg.as_str(), "-c" | "-e" | "--eval"))
}

fn is_network_program(program: &str) -> bool {
    matches!(
        program,
        "curl" | "wget" | "ssh" | "scp" | "sftp" | "rsync" | "nc" | "netcat"
    )
}

fn is_git_network_operation(program: &str, args: &[String]) -> bool {
    program == "git"
        && matches!(
            args.first().map(String::as_str),
            Some("clone" | "fetch" | "pull" | "ls-remote" | "submodule")
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
        _ => false,
    }
}

fn is_external_side_effect(program: &str, args: &[String]) -> bool {
    (program == "npm" && args.first().map(String::as_str) == Some("publish"))
        || (program == "cargo" && args.first().map(String::as_str) == Some("publish"))
        || (program == "gh" && matches!(args.first().map(String::as_str), Some("pr" | "release")))
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
        _ => false,
    }
}

fn is_destructive_filesystem_command(program: &str) -> bool {
    matches!(
        program,
        "rm" | "rmdir" | "unlink" | "dd" | "truncate" | "shred"
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
}
