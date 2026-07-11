//! Workspace-bounded path resolution with symlink escape checks.

use super::AcpError;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// Resolve `requested` against `workspace_root`, rejecting:
/// - empty paths
/// - absolute paths outside the workspace
/// - `..` escapes after normalization
/// - symlink targets that leave the workspace
pub fn resolve_in_workspace(workspace_root: &Path, requested: &str) -> Result<PathBuf, AcpError> {
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
        let canon = std::fs::canonicalize(&lexical)
            .map_err(|e| AcpError::Message(format!("cannot resolve {}: {e}", lexical.display())))?;
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

pub fn read_text_file(
    workspace_root: &Path,
    path: &str,
    limit: Option<usize>,
) -> Result<String, AcpError> {
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
    let initial = resolve_in_workspace(workspace_root, path)?;
    if let Some(parent) = initial.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AcpError::Message(format!("mkdir {}: {e}", parent.display())))?;
    }
    let resolved = resolve_in_workspace(workspace_root, path)?;
    #[cfg(unix)]
    if resolved.exists() {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(&resolved)?;
        if metadata.nlink() > 1 {
            return Err(AcpError::Message(
                "refusing to replace a file with multiple hard links".into(),
            ));
        }
    }
    let parent = resolved
        .parent()
        .ok_or_else(|| AcpError::Message("write target has no parent".into()))?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|error| AcpError::Message(format!("resolve write parent: {error}")))?;
    let canonical_root = std::fs::canonicalize(workspace_root)
        .map_err(|error| AcpError::Message(format!("resolve workspace: {error}")))?;
    if !path_is_under(&canonical_parent, &canonical_root) {
        return Err(AcpError::Message("write parent escaped workspace".into()));
    }
    let target_name = resolved
        .file_name()
        .ok_or_else(|| AcpError::Message("write target has no filename".into()))?;
    let target = canonical_parent.join(target_name);
    let temporary = canonical_parent.join(format!(".grok-build-write-{}", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), AcpError> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| AcpError::Message(format!("create temporary file: {error}")))?;
        file.write_all(content.as_bytes())
            .map_err(|error| AcpError::Message(format!("write temporary file: {error}")))?;
        file.sync_all()
            .map_err(|error| AcpError::Message(format!("sync temporary file: {error}")))?;
        let parent_after = std::fs::canonicalize(parent)
            .map_err(|error| AcpError::Message(format!("recheck write parent: {error}")))?;
        if parent_after != canonical_parent {
            return Err(AcpError::Message(
                "write parent changed during operation".into(),
            ));
        }
        std::fs::rename(&temporary, &target)
            .map_err(|error| AcpError::Message(format!("replace target atomically: {error}")))?;
        std::fs::File::open(&canonical_parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| AcpError::Message(format!("sync write directory: {error}")))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
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

    #[cfg(unix)]
    #[test]
    fn refuses_hard_link_write_target() {
        let ws = temp_ws("hardlink");
        let original = ws.join("original.txt");
        fs::write(&original, "protected").unwrap();
        fs::hard_link(&original, ws.join("alias.txt")).unwrap();
        let error = write_text_file(&ws, "alias.txt", "changed").unwrap_err();
        assert!(error.to_string().contains("hard links"));
        assert_eq!(fs::read_to_string(original).unwrap(), "protected");
    }
}
