//! Workspace-bounded path resolution with symlink escape checks.

use super::AcpError;
use std::path::{Component, Path, PathBuf};

/// Resolve `requested` against `workspace_root`, rejecting:
/// - empty paths
/// - absolute paths outside the workspace
/// - `..` escapes after normalization
/// - symlink targets that leave the workspace
pub fn resolve_in_workspace(
    workspace_root: &Path,
    requested: &str,
) -> Result<PathBuf, AcpError> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err(AcpError::Message("path is empty".into()));
    }

    let root = std::fs::canonicalize(workspace_root).map_err(|e| {
        AcpError::Message(format!(
            "workspace root not accessible ({}): {e}",
            workspace_root.display()
        ))
    })?;

    let candidate = if Path::new(requested).is_absolute() {
        PathBuf::from(requested)
    } else {
        root.join(requested)
    };

    // Lexical normalize (remove . and ..) before existence checks.
    let lexical = normalize_lexical(&candidate);

    // Absolute path must still be under root after lexical normalize.
    if !path_is_under(&lexical, &root) {
        return Err(AcpError::Message(format!(
            "path escapes workspace: {requested}"
        )));
    }

    // If path exists, canonicalize to resolve symlinks and re-check boundary.
    if lexical.exists() {
        let canon = std::fs::canonicalize(&lexical).map_err(|e| {
            AcpError::Message(format!("cannot resolve {}: {e}", lexical.display()))
        })?;
        if !path_is_under(&canon, &root) {
            return Err(AcpError::Message(format!(
                "symlink escapes workspace: {requested}"
            )));
        }
        return Ok(canon);
    }

    // Non-existent path (e.g. write target): ensure every existing parent stays in root.
    let mut parent = lexical.parent().map(|p| p.to_path_buf());
    while let Some(p) = parent {
        if p.exists() {
            let canon_parent = std::fs::canonicalize(&p).map_err(|e| {
                AcpError::Message(format!("cannot resolve parent {}: {e}", p.display()))
            })?;
            if !path_is_under(&canon_parent, &root) {
                return Err(AcpError::Message(format!(
                    "path parent escapes workspace: {requested}"
                )));
            }
            // Rebuild under canonical parent + remaining suffix.
            let suffix = lexical
                .strip_prefix(&p)
                .unwrap_or(lexical.as_path())
                .to_path_buf();
            return Ok(canon_parent.join(suffix));
        }
        if p == root {
            break;
        }
        parent = p.parent().map(|x| x.to_path_buf());
    }

    Ok(lexical)
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(Component::RootDir.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

fn path_is_under(path: &Path, root: &Path) -> bool {
    if path == root {
        return true;
    }
    path.starts_with(root)
}

pub fn read_text_file(workspace_root: &Path, path: &str, limit: Option<usize>) -> Result<String, AcpError> {
    let resolved = resolve_in_workspace(workspace_root, path)?;
    let data = std::fs::read_to_string(&resolved)
        .map_err(|e| AcpError::Message(format!("read {}: {e}", resolved.display())))?;
    if let Some(max) = limit {
        if data.len() > max {
            return Ok(data.chars().take(max).collect::<String>() + "\n…");
        }
    }
    Ok(data)
}

pub fn write_text_file(workspace_root: &Path, path: &str, content: &str) -> Result<(), AcpError> {
    let resolved = resolve_in_workspace(workspace_root, path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AcpError::Message(format!("mkdir {}: {e}", parent.display()))
        })?;
    }
    std::fs::write(&resolved, content)
        .map_err(|e| AcpError::Message(format!("write {}: {e}", resolved.display())))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_ws(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gbd-fs-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_parent_escape() {
        let ws = temp_ws("escape");
        fs::write(ws.join("ok.txt"), "hi").unwrap();
        let err = resolve_in_workspace(&ws, "../outside.txt").unwrap_err();
        assert!(err.to_string().contains("escapes"), "{err}");
    }

    #[test]
    fn rejects_absolute_outside() {
        let ws = temp_ws("abs");
        let outside = std::env::temp_dir().join(format!("gbd-outside-{}", uuid::Uuid::new_v4()));
        fs::write(&outside, "x").unwrap();
        let err = resolve_in_workspace(&ws, outside.to_str().unwrap()).unwrap_err();
        assert!(err.to_string().contains("escapes"), "{err}");
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn rejects_symlink_escape() {
        let ws = temp_ws("sym");
        let outside = std::env::temp_dir().join(format!("gbd-sym-out-{}", uuid::Uuid::new_v4()));
        fs::write(&outside, "secret").unwrap();
        let link = ws.join("leak");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            let err = resolve_in_workspace(&ws, "leak").unwrap_err();
            assert!(
                err.to_string().contains("escapes") || err.to_string().contains("symlink"),
                "{err}"
            );
        }
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn allows_relative_inside() {
        let ws = temp_ws("ok");
        fs::create_dir_all(ws.join("sub")).unwrap();
        fs::write(ws.join("sub/a.txt"), "hello").unwrap();
        let p = resolve_in_workspace(&ws, "sub/a.txt").unwrap();
        assert_eq!(fs::read_to_string(p).unwrap(), "hello");
    }

    #[test]
    fn write_and_read_roundtrip() {
        let ws = temp_ws("rw");
        write_text_file(&ws, "n/e/w.txt", "data").unwrap();
        assert_eq!(read_text_file(&ws, "n/e/w.txt", None).unwrap(), "data");
    }
}
