//! Structured Git inspection (argv arrays only — never shell concatenation).

use crate::contracts::{GitRepoState, ReviewFileEntry, ReviewFileStatus, ReviewSnapshot};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Serialize for GitError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, GitError> {
    let output = Command::new("git").args(args).current_dir(cwd).output()?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(GitError::Message(if err.is_empty() {
            format!("git {:?} failed", args)
        } else {
            err
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_ok(cwd: &Path, args: &[&str]) -> bool {
    git(cwd, args).is_ok()
}

pub fn refresh_review(workspace_root: &str) -> Result<ReviewSnapshot, GitError> {
    let root = PathBuf::from(workspace_root);
    let refreshed_at = crate::acp::iso_now();

    if !root.exists() {
        return Ok(ReviewSnapshot {
            workspace_root: workspace_root.into(),
            repo_root: None,
            head: None,
            branch: None,
            state: GitRepoState::Error,
            files: vec![],
            untracked: vec![],
            error: Some("workspace does not exist".into()),
            refreshed_at,
        });
    }

    if !git_ok(&root, &["rev-parse", "--is-inside-work-tree"]) {
        return Ok(ReviewSnapshot {
            workspace_root: workspace_root.into(),
            repo_root: None,
            head: None,
            branch: None,
            state: GitRepoState::NotARepo,
            files: vec![],
            untracked: vec![],
            error: None,
            refreshed_at,
        });
    }

    let repo_root = git(&root, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let head = git(&root, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());
    let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());

    let mut files: Vec<ReviewFileEntry> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    // Porcelain v1 status
    let status = git(&root, &["status", "--porcelain=1", "-uall"])?;
    for line in status.lines() {
        if line.len() < 3 {
            continue;
        }
        let x = line.as_bytes()[0] as char;
        let y = line.as_bytes()[1] as char;
        let rest = &line[3..];
        let (path, old_path, renamed) = parse_status_path(rest);

        if x == '?' && y == '?' {
            untracked.push(path.clone());
            files.push(ReviewFileEntry {
                path: path.clone(),
                old_path: None,
                status: ReviewFileStatus::Untracked,
                staged: false,
                additions: 0,
                deletions: 0,
                binary: is_binary_path(&path),
            });
            continue;
        }

        let staged = x != ' ' && x != '?';
        let unstaged = y != ' ' && y != '?';
        let status_kind = status_from_codes(x, y, renamed);

        // Prefer unstaged entry when both; emit one row merged.
        if staged || unstaged {
            let (add, del) = numstat_for(&root, &path, staged && !unstaged);
            files.push(ReviewFileEntry {
                path,
                old_path,
                status: status_kind,
                staged: staged && !unstaged,
                additions: add,
                deletions: del,
                binary: is_binary_path(rest),
            });
        }
    }

    let state = if files.is_empty() {
        GitRepoState::Clean
    } else {
        GitRepoState::Dirty
    };

    Ok(ReviewSnapshot {
        workspace_root: workspace_root.into(),
        repo_root: Some(repo_root),
        head,
        branch,
        state,
        files,
        untracked,
        error: None,
        refreshed_at,
    })
}

fn parse_status_path(rest: &str) -> (String, Option<String>, bool) {
    if let Some((a, b)) = rest.split_once(" -> ") {
        (b.to_string(), Some(a.to_string()), true)
    } else {
        (rest.to_string(), None, false)
    }
}

fn status_from_codes(x: char, y: char, renamed: bool) -> ReviewFileStatus {
    if renamed || x == 'R' || y == 'R' {
        return ReviewFileStatus::Renamed;
    }
    let code = if y != ' ' && y != '?' { y } else { x };
    match code {
        'A' => ReviewFileStatus::Added,
        'D' => ReviewFileStatus::Deleted,
        'M' => ReviewFileStatus::Modified,
        'C' => ReviewFileStatus::Copied,
        'U' => ReviewFileStatus::Conflicted,
        _ => ReviewFileStatus::Modified,
    }
}

fn numstat_for(root: &Path, path: &str, staged: bool) -> (u32, u32) {
    let args: Vec<&str> = if staged {
        vec!["diff", "--numstat", "--cached", "--", path]
    } else {
        vec!["diff", "--numstat", "--", path]
    };
    let Ok(out) = git(root, &args) else {
        return (0, 0);
    };
    for line in out.lines() {
        let parts: Vec<_> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let a = parts[0].parse().unwrap_or(0);
            let d = parts[1].parse().unwrap_or(0);
            return (a, d);
        }
    }
    (0, 0)
}

fn is_binary_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".ico")
        || lower.ends_with(".pdf")
        || lower.ends_with(".zip")
        || lower.ends_with(".wasm")
}

/// Text unified diff for a path (truncated).
pub fn file_patch(
    workspace_root: &str,
    path: &str,
    staged: bool,
    max_bytes: usize,
) -> Result<String, GitError> {
    let root = PathBuf::from(workspace_root);
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", path]
    } else {
        vec!["diff", "--", path]
    };
    let mut out = git(&root, &args)?;
    if out.is_empty() {
        // Untracked: show as /dev/null diff via show if file exists
        let full = root.join(path);
        if full.is_file() {
            let content = std::fs::read_to_string(&full).unwrap_or_default();
            out = format!("--- /dev/null\n+++ b/{path}\n{content}");
        }
    }
    if out.len() > max_bytes {
        out.truncate(max_bytes);
        out.push_str("\n… [truncated]");
    }
    Ok(out)
}

// --- Worktrees ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSummary {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
    pub dirty: Option<bool>,
    pub source: String,
    pub main_workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateRequest {
    pub workspace_root: String,
    pub r#ref: Option<String>,
    pub path: Option<String>,
    pub branch: Option<String>,
    pub dirty_policy: String, // clean_head | copy_dirty
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDeleteRequest {
    pub path: String,
    pub force: bool,
}

pub fn list_git_worktrees(workspace_root: &str) -> Result<Vec<WorktreeSummary>, GitError> {
    let root = PathBuf::from(workspace_root);
    if !git_ok(&root, &["rev-parse", "--is-inside-work-tree"]) {
        return Ok(vec![]);
    }
    let out = git(&root, &["worktree", "list", "--porcelain"])?;
    let mut items = Vec::new();
    let mut current: Option<WorktreeSummary> = None;
    for line in out.lines() {
        if line.is_empty() {
            if let Some(mut wt) = current.take() {
                wt.dirty = Some(worktree_dirty(&wt.path));
                items.push(wt);
            }
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(mut wt) = current.take() {
                wt.dirty = Some(worktree_dirty(&wt.path));
                items.push(wt);
            }
            current = Some(WorktreeSummary {
                path: p.to_string(),
                branch: None,
                head: None,
                bare: false,
                locked: false,
                prunable: false,
                dirty: None,
                source: "git".into(),
                main_workspace: Some(workspace_root.into()),
            });
        } else if let Some(c) = current.as_mut() {
            if let Some(h) = line.strip_prefix("HEAD ") {
                c.head = Some(h.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                c.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line == "bare" {
                c.bare = true;
            } else if line.starts_with("locked") {
                c.locked = true;
            } else if line == "prunable" {
                c.prunable = true;
            }
        }
    }
    if let Some(mut wt) = current.take() {
        wt.dirty = Some(worktree_dirty(&wt.path));
        items.push(wt);
    }
    Ok(items)
}

fn worktree_dirty(path: &str) -> bool {
    let p = PathBuf::from(path);
    git(&p, &["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

pub fn list_grok_worktrees() -> Result<Vec<WorktreeSummary>, GitError> {
    // `grok worktree list --json` when available; degrade gracefully.
    let output = Command::new("grok")
        .args(["worktree", "list", "--json"])
        .output();
    let Ok(output) = output else {
        return Ok(vec![]);
    };
    if !output.status.success() {
        return Ok(vec![]);
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    let arr = parsed
        .as_array()
        .cloned()
        .or_else(|| parsed.get("worktrees").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in arr {
        let path = item
            .get("path")
            .or_else(|| item.get("dir"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if path.is_empty() {
            continue;
        }
        out.push(WorktreeSummary {
            path: path.clone(),
            branch: item
                .get("branch")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            head: item
                .get("head")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            bare: false,
            locked: false,
            prunable: false,
            dirty: item.get("dirty").and_then(|v| v.as_bool()),
            source: "grok".into(),
            main_workspace: item
                .get("mainWorkspace")
                .or_else(|| item.get("main"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }
    Ok(out)
}

pub fn list_merged_worktrees(workspace_root: &str) -> Result<Vec<WorktreeSummary>, GitError> {
    let mut git_list = list_git_worktrees(workspace_root)?;
    let grok_list = list_grok_worktrees().unwrap_or_default();
    for g in grok_list {
        if let Some(existing) = git_list.iter_mut().find(|w| w.path == g.path) {
            existing.source = "merged".into();
            if existing.branch.is_none() {
                existing.branch = g.branch;
            }
            if existing.dirty.is_none() {
                existing.dirty = g.dirty;
            }
        } else {
            git_list.push(WorktreeSummary {
                source: "merged".into(),
                main_workspace: g.main_workspace.or_else(|| Some(workspace_root.into())),
                ..g
            });
        }
    }
    Ok(git_list)
}

pub fn create_worktree(req: &WorktreeCreateRequest) -> Result<WorktreeSummary, GitError> {
    let root = PathBuf::from(&req.workspace_root);
    let dirty = worktree_dirty(&req.workspace_root);
    if dirty && req.dirty_policy != "clean_head" && req.dirty_policy != "copy_dirty" {
        return Err(GitError::Message(
            "workspace has uncommitted changes; choose dirtyPolicy clean_head or copy_dirty".into(),
        ));
    }
    if dirty && req.dirty_policy.is_empty() {
        return Err(GitError::Message(
            "workspace dirty: explicit dirtyPolicy required (clean_head | copy_dirty)".into(),
        ));
    }

    let path = req.path.clone().unwrap_or_else(|| {
        let name = req
            .branch
            .clone()
            .unwrap_or_else(|| format!("wt-{}", &uuid::Uuid::new_v4().to_string()[..8]));
        root.join(".worktrees").join(name).to_string_lossy().into()
    });

    let mut args: Vec<String> = vec!["worktree".into(), "add".into()];
    if let Some(branch) = &req.branch {
        args.push("-b".into());
        args.push(branch.clone());
    }
    args.push(path.clone());
    if let Some(r) = &req.r#ref {
        args.push(r.clone());
    } else {
        args.push("HEAD".into());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    git(&root, &arg_refs)?;

    if dirty && req.dirty_policy == "copy_dirty" {
        // Explicit copy of working tree changes via git checkout of dirty files is complex;
        // use rsync-like copy of tracked dirty paths only when user chose copy_dirty.
        copy_dirty_files(&root, Path::new(&path))?;
    }

    Ok(WorktreeSummary {
        path: path.clone(),
        branch: req.branch.clone(),
        head: git(Path::new(&path), &["rev-parse", "--short", "HEAD"])
            .ok()
            .map(|s| s.trim().to_string()),
        bare: false,
        locked: false,
        prunable: false,
        dirty: Some(worktree_dirty(&path)),
        source: "git".into(),
        main_workspace: Some(req.workspace_root.clone()),
    })
}

fn copy_dirty_files(src_root: &Path, dest_root: &Path) -> Result<(), GitError> {
    let status = git(src_root, &["status", "--porcelain=1", "-uall"])?;
    for line in status.lines() {
        if line.len() < 3 {
            continue;
        }
        let rest = &line[3..];
        let path = if let Some((_, b)) = rest.split_once(" -> ") {
            b
        } else {
            rest
        };
        let from = src_root.join(path);
        let to = dest_root.join(path);
        if from.is_file() {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let _ = std::fs::copy(&from, &to);
        }
    }
    Ok(())
}

pub fn delete_worktree(req: &WorktreeDeleteRequest, main_workspace: &str) -> Result<(), GitError> {
    let root = PathBuf::from(main_workspace);
    let mut args = vec!["worktree", "remove"];
    if req.force {
        args.push("--force");
    }
    args.push(req.path.as_str());
    git(&root, &args)?;
    // Prune metadata
    let _ = git(&root, &["worktree", "prune"]);
    Ok(())
}

pub fn worktree_delete_preview(path: &str) -> Result<serde_json::Value, GitError> {
    let p = PathBuf::from(path);
    let branch = git(&p, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());
    let dirty = worktree_dirty(path);
    Ok(serde_json::json!({
        "path": path,
        "branch": branch,
        "dirty": dirty,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gbd-git-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .status()
            .unwrap();
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(&dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&dir)
            .status()
            .unwrap();
        dir
    }

    #[test]
    fn clean_and_dirty_repo() {
        let repo = temp_repo();
        let snap = refresh_review(repo.to_str().unwrap()).unwrap();
        assert_eq!(snap.state, GitRepoState::Clean);

        std::fs::write(repo.join("a.txt"), "changed").unwrap();
        let snap = refresh_review(repo.to_str().unwrap()).unwrap();
        assert_eq!(snap.state, GitRepoState::Dirty);
        assert!(!snap.files.is_empty());
    }

    #[test]
    fn not_a_repo() {
        let dir = std::env::temp_dir().join(format!("gbd-norepo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let snap = refresh_review(dir.to_str().unwrap()).unwrap();
        assert_eq!(snap.state, GitRepoState::NotARepo);
    }

    #[test]
    fn worktree_create_clean_and_delete() {
        let repo = temp_repo();
        let wt_path = repo.join("wt1");
        let created = create_worktree(&WorktreeCreateRequest {
            workspace_root: repo.to_string_lossy().into(),
            r#ref: Some("HEAD".into()),
            path: Some(wt_path.to_string_lossy().into()),
            branch: Some("feat-wt".into()),
            dirty_policy: "clean_head".into(),
        })
        .unwrap();
        assert!(Path::new(&created.path).exists());
        let list = list_merged_worktrees(repo.to_str().unwrap()).unwrap();
        let created_canon =
            std::fs::canonicalize(&created.path).unwrap_or(created.path.clone().into());
        assert!(
            list.iter().any(|w| {
                let p = std::fs::canonicalize(&w.path).unwrap_or_else(|_| PathBuf::from(&w.path));
                p == created_canon || w.path == created.path || w.path.ends_with("wt1")
            }),
            "worktree not listed: created={:?} list={:?}",
            created.path,
            list.iter().map(|w| &w.path).collect::<Vec<_>>()
        );
        delete_worktree(
            &WorktreeDeleteRequest {
                path: created.path.clone(),
                force: true,
            },
            repo.to_str().unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn dirty_requires_policy() {
        let repo = temp_repo();
        std::fs::write(repo.join("a.txt"), "dirty").unwrap();
        let err = create_worktree(&WorktreeCreateRequest {
            workspace_root: repo.to_string_lossy().into(),
            r#ref: None,
            path: Some(repo.join("wt-d").to_string_lossy().into()),
            branch: Some("d".into()),
            dirty_policy: "".into(),
        })
        .unwrap_err();
        assert!(err.to_string().contains("dirty"));
    }
}
