//! Read-only workspace explorer owned by the Agent Host.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

const MAX_PREVIEW_BYTES: u64 = 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 10_000;
const MAX_SEARCH_FILES: usize = 5_000;
const MAX_SEARCH_RESULTS: usize = 200;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub path: String,
    pub name: String,
    pub directory: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreview {
    pub path: String,
    pub content: Option<String>,
    pub binary: bool,
    pub truncated: bool,
    pub size: u64,
}

pub fn tree(root: &str, relative: Option<&str>) -> Result<Vec<WorkspaceEntry>, WorkspaceError> {
    let root = canonical_root(root)?;
    let directory = resolve_existing(&root, relative.unwrap_or(""))?;
    if !directory.is_dir() {
        return Err(WorkspaceError::Message(
            "workspace tree target is not a directory".into(),
        ));
    }
    let mut entries = Vec::new();
    for item in std::fs::read_dir(directory)?.take(MAX_TREE_ENTRIES) {
        let item = item?;
        let metadata = item.file_type()?;
        if metadata.is_symlink() {
            continue;
        }
        let path = item.path();
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| WorkspaceError::Message("workspace path escaped root".into()))?;
        entries.push(WorkspaceEntry {
            path: relative.to_string_lossy().into(),
            name: item.file_name().to_string_lossy().into(),
            directory: metadata.is_dir(),
            size: metadata
                .is_file()
                .then(|| item.metadata().ok().map(|m| m.len()))
                .flatten(),
        });
    }
    entries.sort_by(|left, right| {
        right
            .directory
            .cmp(&left.directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn read(root: &str, relative: &str) -> Result<WorkspacePreview, WorkspaceError> {
    let root = canonical_root(root)?;
    let path = resolve_existing(&root, relative)?;
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() {
        return Err(WorkspaceError::Message(
            "workspace preview target is not a regular file".into(),
        ));
    }
    let size = metadata.len();
    let bytes = std::fs::read(&path)?;
    let preview = &bytes[..bytes.len().min(MAX_PREVIEW_BYTES as usize)];
    let binary = preview.contains(&0);
    Ok(WorkspacePreview {
        path: relative.into(),
        content: (!binary).then(|| String::from_utf8_lossy(preview).into()),
        binary,
        truncated: size > MAX_PREVIEW_BYTES,
        size,
    })
}

pub fn search(root: &str, query: &str) -> Result<Vec<WorkspaceEntry>, WorkspaceError> {
    let root = canonical_root(root)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let mut queue = VecDeque::from([root.clone()]);
    let mut visited = 0_usize;
    let mut results = Vec::new();
    while let Some(directory) = queue.pop_front() {
        for item in std::fs::read_dir(directory)? {
            if visited >= MAX_SEARCH_FILES || results.len() >= MAX_SEARCH_RESULTS {
                return Ok(results);
            }
            visited += 1;
            let item = item?;
            let kind = item.file_type()?;
            if kind.is_symlink() {
                continue;
            }
            let path = item.path();
            if kind.is_dir()
                && !matches!(
                    item.file_name().to_str(),
                    Some(".git" | "node_modules" | "target")
                )
            {
                queue.push_back(path.clone());
            }
            let relative = path
                .strip_prefix(&root)
                .map_err(|_| WorkspaceError::Message("workspace path escaped root".into()))?;
            let name_matches = relative.to_string_lossy().to_lowercase().contains(&query);
            let content_matches = if kind.is_file() {
                let metadata = item.metadata().ok();
                if metadata
                    .as_ref()
                    .is_some_and(|metadata| metadata.len() <= MAX_PREVIEW_BYTES)
                {
                    std::fs::read(&path)
                        .ok()
                        .filter(|bytes| !bytes.contains(&0))
                        .map(|bytes| {
                            String::from_utf8_lossy(&bytes)
                                .to_lowercase()
                                .contains(&query)
                        })
                        .unwrap_or(false)
                } else {
                    false
                }
            } else {
                false
            };
            if name_matches || content_matches {
                results.push(WorkspaceEntry {
                    path: relative.to_string_lossy().into(),
                    name: item.file_name().to_string_lossy().into(),
                    directory: kind.is_dir(),
                    size: kind
                        .is_file()
                        .then(|| item.metadata().ok().map(|m| m.len()))
                        .flatten(),
                });
            }
        }
    }
    Ok(results)
}

fn canonical_root(root: &str) -> Result<PathBuf, WorkspaceError> {
    let root = std::fs::canonicalize(root)?;
    if !root.is_dir() {
        return Err(WorkspaceError::Message(
            "workspace root is not a directory".into(),
        ));
    }
    Ok(root)
}

fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
            && !relative.as_os_str().is_empty()
    {
        return Err(WorkspaceError::Message("unsafe workspace path".into()));
    }
    let resolved = std::fs::canonicalize(root.join(relative))?;
    if !resolved.starts_with(root) {
        return Err(WorkspaceError::Message(
            "workspace path escaped root".into(),
        ));
    }
    Ok(resolved)
}
