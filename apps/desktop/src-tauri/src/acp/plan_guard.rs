//! Plan-mode terminal allowlist used by ACP handlers.
//!
//! Extracted so policy-adjacent plan rules stay reviewable without scanning
//! the full server-request router.

/// Plan mode uses a strict **allowlist** of inspection-only tools. Anything else
/// (shells, package scripts, compilers that run code, writers) is blocked until
/// the plan is approved.
pub fn plan_mode_blocks_terminal(command: &str, args: &[String]) -> bool {
    !plan_mode_allows_terminal(command, args)
}

pub fn plan_mode_allows_terminal(command: &str, args: &[String]) -> bool {
    let program = std::path::Path::new(command)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();

    // Never allow shells or interactive interpreters in plan mode.
    if matches!(
        program.as_str(),
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
            | "python"
            | "python3"
            | "node"
            | "nodejs"
            | "ruby"
            | "perl"
            | "php"
            | "osascript"
            | "sudo"
            | "doas"
            | "docker"
            | "kubectl"
            | "npx"
            | "make"
            | "cmake"
    ) {
        return false;
    }

    match program.as_str() {
        "git" => args.first().is_some_and(|arg| {
            matches!(
                arg.as_str(),
                "status"
                    | "diff"
                    | "log"
                    | "show"
                    | "branch"
                    | "rev-parse"
                    | "ls-files"
                    | "blame"
                    | "describe"
                    | "remote"
            )
        }),
        // Metadata only — cargo test/check/build can execute build scripts.
        "cargo" => args.first().is_some_and(|arg| {
            matches!(
                arg.as_str(),
                "tree" | "metadata" | "version" | "-V" | "--version"
            )
        }),
        "npm" | "pnpm" | "yarn" => args.first().is_some_and(|arg| {
            matches!(
                arg.as_str(),
                "ls" | "list" | "view" | "outdated" | "explain" | "why" | "pack"
            )
        }),
        "rg" | "grep" | "ag" | "ack" | "fd" | "find" | "ls" | "cat" | "head" | "tail" | "wc"
        | "file" | "which" | "whereis" | "pwd" | "true" | "false" | "date" | "uname" | "stat"
        | "diff" | "cmp" | "sort" | "uniq" | "cut" | "tr" | "echo" | "printf" | "basename"
        | "dirname" | "realpath" | "readlink" | "jq" | "yq" | "tree" | "nl" => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_mode_allowlist_blocks_scripts_and_tests() {
        assert!(plan_mode_blocks_terminal(
            "/bin/zsh",
            &["-lc".into(), "echo hi".into()]
        ));
        assert!(!plan_mode_blocks_terminal("git", &["status".into()]));
        assert!(plan_mode_blocks_terminal(
            "git",
            &["commit".into(), "-am".into(), "x".into()]
        ));
        assert!(plan_mode_blocks_terminal(
            "npm",
            &["run".into(), "build".into()]
        ));
        assert!(plan_mode_blocks_terminal("cargo", &["test".into()]));
        assert!(plan_mode_blocks_terminal("python3", &["inspect.py".into()]));
        assert!(!plan_mode_blocks_terminal("rg", &["TODO".into()]));
    }
}
