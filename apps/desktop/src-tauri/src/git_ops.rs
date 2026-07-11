//! Structured Git inspection (argv arrays only — never shell concatenation).

use crate::contracts::{GitRepoState, ReviewFileEntry, ReviewFileStatus, ReviewSnapshot};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
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

fn git_bytes(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, GitError> {
    let output = Command::new("git").args(args).current_dir(cwd).output()?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(GitError::Message(if err.is_empty() {
            format!("git {:?} failed", args)
        } else {
            err
        }));
    }
    Ok(output.stdout)
}

fn git_with_input(cwd: &Path, args: &[&str], input: &[u8]) -> Result<(), GitError> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| GitError::Message("failed to open git stdin".into()))?
        .write_all(input)?;
    let output = child.wait_with_output()?;
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(GitError::Message(if err.is_empty() {
            format!("git {:?} failed", args)
        } else {
            err
        }))
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeApplyRequest {
    pub main_workspace: String,
    pub worktree_path: String,
    pub base_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeApplyPreview {
    pub ready: bool,
    pub reason: Option<String>,
    pub main_head: Option<String>,
    pub base_commit: String,
    pub files: Vec<String>,
    pub untracked: Vec<String>,
    pub patch_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeApplyResult {
    pub applied_at: String,
    pub files_applied: usize,
}

struct PreparedApply {
    preview: WorktreeApplyPreview,
    patch: Vec<u8>,
    untracked: Vec<(PathBuf, Vec<u8>)>,
}

fn safe_relative_path(path: &str) -> bool {
    let value = Path::new(path);
    !value.is_absolute()
        && value.components().all(|part| {
            !matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn same_commit(current: &str, expected: &str) -> bool {
    !expected.trim().is_empty()
        && (current.starts_with(expected.trim()) || expected.trim().starts_with(current))
}

fn blocked_preview(
    req: &WorktreeApplyRequest,
    main_head: Option<String>,
    reason: impl Into<String>,
) -> PreparedApply {
    PreparedApply {
        preview: WorktreeApplyPreview {
            ready: false,
            reason: Some(reason.into()),
            main_head,
            base_commit: req.base_commit.clone(),
            files: vec![],
            untracked: vec![],
            patch_bytes: 0,
        },
        patch: vec![],
        untracked: vec![],
    }
}

fn prepare_worktree_apply(req: &WorktreeApplyRequest) -> Result<PreparedApply, GitError> {
    let main = PathBuf::from(&req.main_workspace);
    let worktree = PathBuf::from(&req.worktree_path);
    if !git_ok(&main, &["rev-parse", "--is-inside-work-tree"])
        || !git_ok(&worktree, &["rev-parse", "--is-inside-work-tree"])
    {
        return Ok(blocked_preview(
            req,
            None,
            "Both paths must be Git worktrees",
        ));
    }

    let main_head = git(&main, &["rev-parse", "HEAD"])?.trim().to_string();
    if !same_commit(&main_head, &req.base_commit) {
        return Ok(blocked_preview(
            req,
            Some(main_head),
            "The main workspace HEAD no longer matches this task's base commit",
        ));
    }
    if !git(&main, &["status", "--porcelain=1", "-uall"])?
        .trim()
        .is_empty()
    {
        return Ok(blocked_preview(
            req,
            Some(main_head),
            "The main workspace has uncommitted changes",
        ));
    }

    let review = refresh_review(&req.worktree_path)?;
    let files = review
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    if files.is_empty() {
        return Ok(blocked_preview(
            req,
            Some(main_head),
            "There are no task changes to apply",
        ));
    }

    let patch = git_bytes(&worktree, &["diff", "--binary", "--full-index", "HEAD"])?;
    if !patch.is_empty() {
        if let Err(error) = git_with_input(&main, &["apply", "--check", "--binary", "-"], &patch) {
            return Ok(blocked_preview(
                req,
                Some(main_head),
                format!("Patch dry-run failed: {error}"),
            ));
        }
    }

    let mut untracked = Vec::new();
    for relative in &review.untracked {
        if !safe_relative_path(relative) {
            return Ok(blocked_preview(
                req,
                Some(main_head),
                format!("Unsafe untracked path: {relative}"),
            ));
        }
        let destination = main.join(relative);
        if destination.exists() {
            return Ok(blocked_preview(
                req,
                Some(main_head),
                format!("Untracked file already exists in the main workspace: {relative}"),
            ));
        }
        untracked.push((
            PathBuf::from(relative),
            std::fs::read(worktree.join(relative))?,
        ));
    }

    Ok(PreparedApply {
        preview: WorktreeApplyPreview {
            ready: true,
            reason: None,
            main_head: Some(main_head),
            base_commit: req.base_commit.clone(),
            files,
            untracked: review.untracked,
            patch_bytes: patch.len(),
        },
        patch,
        untracked,
    })
}

pub fn worktree_apply_preview(
    req: &WorktreeApplyRequest,
) -> Result<WorktreeApplyPreview, GitError> {
    Ok(prepare_worktree_apply(req)?.preview)
}

pub fn apply_worktree_changes(req: &WorktreeApplyRequest) -> Result<WorktreeApplyResult, GitError> {
    // Re-run every preflight immediately before writing. The UI preview is never
    // trusted as authorization for a stale workspace state.
    let prepared = prepare_worktree_apply(req)?;
    if !prepared.preview.ready {
        return Err(GitError::Message(
            prepared
                .preview
                .reason
                .unwrap_or_else(|| "Apply preflight failed".into()),
        ));
    }

    let main = PathBuf::from(&req.main_workspace);
    if !prepared.patch.is_empty() {
        git_with_input(&main, &["apply", "--binary", "-"], &prepared.patch)?;
    }

    let mut copied = Vec::new();
    for (relative, contents) in &prepared.untracked {
        let destination = main.join(relative);
        let result = (|| -> Result<(), std::io::Error> {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&destination, contents)
        })();
        if let Err(error) = result {
            for path in copied.iter().rev() {
                let _ = std::fs::remove_file(path);
            }
            if !prepared.patch.is_empty() {
                let _ = git_with_input(&main, &["apply", "-R", "--binary", "-"], &prepared.patch);
            }
            return Err(GitError::Io(error));
        }
        copied.push(destination);
    }

    Ok(WorktreeApplyResult {
        applied_at: crate::acp::iso_now(),
        files_applied: prepared.preview.files.len(),
    })
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitFileAction {
    Stage,
    Unstage,
    Revert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileActionRequest {
    pub workspace_root: String,
    pub path: String,
    pub action: GitFileAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunkActionRequest {
    pub workspace_root: String,
    pub path: String,
    pub patch: String,
    pub action: GitFileAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    pub workspace_root: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub commit: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckpoint {
    pub checkpoint_id: String,
    pub head: String,
    pub created_at: String,
    pub files: Vec<String>,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckpointRestorePreview {
    pub checkpoint: GitCheckpoint,
    pub current_head: String,
    pub ready: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMutationResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<GitCheckpoint>,
}

pub fn apply_file_action(req: &GitFileActionRequest) -> Result<(), GitError> {
    if !safe_relative_path(&req.path) || req.path.trim().is_empty() {
        return Err(GitError::Message("unsafe Git path".into()));
    }
    let root = Path::new(&req.workspace_root);
    match req.action {
        GitFileAction::Stage => {
            git(root, &["add", "--", &req.path])?;
        }
        GitFileAction::Unstage => {
            git(root, &["restore", "--staged", "--", &req.path])?;
        }
        GitFileAction::Revert => {
            // Refuse to turn "revert" into an implicit deletion of an untracked file.
            git(root, &["ls-files", "--error-unmatch", "--", &req.path])?;
            git(root, &["restore", "--worktree", "--", &req.path])?;
        }
    }
    Ok(())
}

pub fn apply_hunk_action(req: &GitHunkActionRequest) -> Result<(), GitError> {
    if !safe_relative_path(&req.path) || req.path.trim().is_empty() {
        return Err(GitError::Message("unsafe Git path".into()));
    }
    validate_single_file_patch(&req.patch, &req.path)?;
    let root = Path::new(&req.workspace_root);
    let bytes = req.patch.as_bytes();
    match req.action {
        GitFileAction::Stage => {
            git_with_input(root, &["apply", "--cached", "--check", "-"], bytes)?;
            git_with_input(root, &["apply", "--cached", "-"], bytes)?;
        }
        GitFileAction::Unstage => {
            git_with_input(
                root,
                &["apply", "--cached", "--reverse", "--check", "-"],
                bytes,
            )?;
            git_with_input(root, &["apply", "--cached", "--reverse", "-"], bytes)?;
        }
        GitFileAction::Revert => {
            git_with_input(root, &["apply", "--reverse", "--check", "-"], bytes)?;
            git_with_input(root, &["apply", "--reverse", "-"], bytes)?;
        }
    }
    Ok(())
}

pub fn commit(req: &GitCommitRequest) -> Result<GitCommitResult, GitError> {
    let message = req.message.trim();
    if message.is_empty() {
        return Err(GitError::Message("commit message is empty".into()));
    }
    if message.len() > 10_000 {
        return Err(GitError::Message("commit message is too long".into()));
    }
    let root = Path::new(&req.workspace_root);
    let summary = git(root, &["commit", "-m", message])?;
    let commit = git(root, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(GitCommitResult { commit, summary })
}

pub fn create_checkpoint(workspace_root: &str) -> Result<GitCheckpoint, GitError> {
    const MAX_CHECKPOINT_BYTES: u64 = 100 * 1024 * 1024;
    const MAX_UNTRACKED_FILES: usize = 1_000;

    let root = Path::new(workspace_root);
    let git_dir_raw = git(root, &["rev-parse", "--git-dir"])?;
    let git_dir = {
        let value = PathBuf::from(git_dir_raw.trim());
        if value.is_absolute() {
            value
        } else {
            root.join(value)
        }
    };
    let checkpoint_id = uuid::Uuid::new_v4().to_string();
    let checkpoint_root = git_dir
        .join("grok-build")
        .join("checkpoints")
        .join(&checkpoint_id);
    std::fs::create_dir_all(checkpoint_root.join("untracked"))?;

    let head = git(root, &["rev-parse", "HEAD"])?.trim().to_string();
    let working_patch = git_bytes(root, &["diff", "--binary"])?;
    let index_patch = git_bytes(root, &["diff", "--cached", "--binary"])?;
    let untracked_raw = git_bytes(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    let untracked = untracked_raw
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
        .map(|value| String::from_utf8_lossy(value).to_string())
        .collect::<Vec<_>>();
    if untracked.len() > MAX_UNTRACKED_FILES {
        return Err(GitError::Message(
            "checkpoint has too many untracked files".into(),
        ));
    }

    let mut total = (working_patch.len() + index_patch.len()) as u64;
    let mut files = Vec::new();
    for relative in untracked {
        if !safe_relative_path(&relative) {
            return Err(GitError::Message(format!(
                "unsafe untracked path {relative}"
            )));
        }
        let source = root.join(&relative);
        let metadata = std::fs::symlink_metadata(&source)?;
        if !metadata.file_type().is_file() {
            return Err(GitError::Message(format!(
                "checkpoint refuses non-regular untracked path {relative}"
            )));
        }
        total = total.saturating_add(metadata.len());
        if total > MAX_CHECKPOINT_BYTES {
            return Err(GitError::Message("checkpoint exceeds 100 MB".into()));
        }
        let destination = checkpoint_root.join("untracked").join(&relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(source, destination)?;
        files.push(relative);
    }
    std::fs::write(checkpoint_root.join("working.patch"), working_patch)?;
    std::fs::write(checkpoint_root.join("index.patch"), index_patch)?;
    let checkpoint = GitCheckpoint {
        checkpoint_id,
        head,
        created_at: crate::acp::iso_now(),
        files,
        bytes: total,
    };
    std::fs::write(
        checkpoint_root.join("metadata.json"),
        serde_json::to_vec_pretty(&checkpoint)
            .map_err(|error| GitError::Message(error.to_string()))?,
    )?;
    Ok(checkpoint)
}

pub fn checkpoint_restore_preview(
    workspace_root: &str,
    checkpoint_id: &str,
) -> Result<GitCheckpointRestorePreview, GitError> {
    let root = Path::new(workspace_root);
    let (checkpoint_root, checkpoint) = load_checkpoint(root, checkpoint_id)?;
    let current_head = git(root, &["rev-parse", "HEAD"])?.trim().to_string();
    let reason = if current_head != checkpoint.head {
        Some("HEAD no longer matches the checkpoint".into())
    } else if !git(root, &["status", "--porcelain"])?.trim().is_empty() {
        Some("workspace must be clean before restoring a checkpoint".into())
    } else if checkpoint
        .files
        .iter()
        .any(|relative| root.join(relative).exists())
    {
        Some("an untracked checkpoint file already exists".into())
    } else {
        let index_patch = std::fs::read(checkpoint_root.join("index.patch"))?;
        let working_patch = std::fs::read(checkpoint_root.join("working.patch"))?;
        if !index_patch.is_empty()
            && git_with_input(root, &["apply", "--cached", "--check", "-"], &index_patch).is_err()
        {
            Some("staged checkpoint patch no longer applies".into())
        } else if !working_patch.is_empty()
            && git_with_input(root, &["apply", "--check", "-"], &working_patch).is_err()
        {
            Some("working checkpoint patch no longer applies".into())
        } else {
            None
        }
    };
    Ok(GitCheckpointRestorePreview {
        checkpoint,
        current_head,
        ready: reason.is_none(),
        reason,
    })
}

pub fn restore_checkpoint(
    workspace_root: &str,
    checkpoint_id: &str,
) -> Result<GitCheckpoint, GitError> {
    let preview = checkpoint_restore_preview(workspace_root, checkpoint_id)?;
    if !preview.ready {
        return Err(GitError::Message(
            preview
                .reason
                .unwrap_or_else(|| "checkpoint is not restorable".into()),
        ));
    }
    let root = Path::new(workspace_root);
    let (checkpoint_root, checkpoint) = load_checkpoint(root, checkpoint_id)?;
    let index_patch = std::fs::read(checkpoint_root.join("index.patch"))?;
    let working_patch = std::fs::read(checkpoint_root.join("working.patch"))?;
    if !index_patch.is_empty() {
        git_with_input(root, &["apply", "--cached", "-"], &index_patch)?;
    }
    if !working_patch.is_empty() {
        git_with_input(root, &["apply", "-"], &working_patch)?;
    }
    for relative in &checkpoint.files {
        if !safe_relative_path(relative) {
            return Err(GitError::Message(
                "checkpoint contains an unsafe path".into(),
            ));
        }
        let destination = root.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(
            checkpoint_root.join("untracked").join(relative),
            destination,
        )?;
    }
    Ok(checkpoint)
}

fn load_checkpoint(
    workspace_root: &Path,
    checkpoint_id: &str,
) -> Result<(PathBuf, GitCheckpoint), GitError> {
    if checkpoint_id.is_empty()
        || !checkpoint_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(GitError::Message("invalid checkpoint id".into()));
    }
    let git_dir_raw = git(workspace_root, &["rev-parse", "--git-dir"])?;
    let git_dir = PathBuf::from(git_dir_raw.trim());
    let git_dir = if git_dir.is_absolute() {
        git_dir
    } else {
        workspace_root.join(git_dir)
    };
    let checkpoint_root = git_dir
        .join("grok-build")
        .join("checkpoints")
        .join(checkpoint_id);
    let metadata = std::fs::read(checkpoint_root.join("metadata.json"))?;
    let checkpoint = serde_json::from_slice(&metadata)
        .map_err(|error| GitError::Message(format!("invalid checkpoint metadata: {error}")))?;
    Ok((checkpoint_root, checkpoint))
}

fn validate_single_file_patch(patch: &str, expected_path: &str) -> Result<(), GitError> {
    if patch.len() > 4 * 1024 * 1024 {
        return Err(GitError::Message("hunk patch exceeds 4 MB".into()));
    }
    let mut headers = Vec::new();
    for line in patch.lines() {
        if let Some(path) = line
            .strip_prefix("--- ")
            .or_else(|| line.strip_prefix("+++ "))
        {
            let path = path.split('\t').next().unwrap_or(path);
            if path != "/dev/null" {
                let normalized = path
                    .strip_prefix("a/")
                    .or_else(|| path.strip_prefix("b/"))
                    .unwrap_or(path);
                headers.push(normalized.to_string());
            }
        }
    }
    if headers.is_empty() || headers.iter().any(|path| path != expected_path) {
        return Err(GitError::Message(
            "hunk patch may modify only the requested file".into(),
        ));
    }
    Ok(())
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

    #[test]
    fn apply_preview_checks_then_applies_tracked_and_untracked_files() {
        let repo = temp_repo();
        let base = git(&repo, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        let worktree = std::env::temp_dir().join(format!("gbd-apply-{}", uuid::Uuid::new_v4()));
        create_worktree(&WorktreeCreateRequest {
            workspace_root: repo.to_string_lossy().into(),
            r#ref: Some("HEAD".into()),
            path: Some(worktree.to_string_lossy().into()),
            branch: Some(format!("apply-{}", &uuid::Uuid::new_v4().to_string()[..8])),
            dirty_policy: "clean_head".into(),
        })
        .unwrap();
        std::fs::write(worktree.join("a.txt"), "changed").unwrap();
        std::fs::write(worktree.join("new.txt"), "new file").unwrap();

        let req = WorktreeApplyRequest {
            main_workspace: repo.to_string_lossy().into(),
            worktree_path: worktree.to_string_lossy().into(),
            base_commit: base,
        };
        let preview = worktree_apply_preview(&req).unwrap();
        assert!(preview.ready, "preview was blocked: {:?}", preview.reason);
        assert_eq!(preview.files.len(), 2);

        let result = apply_worktree_changes(&req).unwrap();
        assert_eq!(result.files_applied, 2);
        assert_eq!(
            std::fs::read_to_string(repo.join("a.txt")).unwrap(),
            "changed"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("new.txt")).unwrap(),
            "new file"
        );
    }

    #[test]
    fn apply_preview_refuses_a_dirty_main_workspace() {
        let repo = temp_repo();
        let base = git(&repo, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        std::fs::write(repo.join("a.txt"), "local edit").unwrap();
        let preview = worktree_apply_preview(&WorktreeApplyRequest {
            main_workspace: repo.to_string_lossy().into(),
            worktree_path: repo.to_string_lossy().into(),
            base_commit: base,
        })
        .unwrap();
        assert!(!preview.ready);
        assert!(preview.reason.unwrap().contains("uncommitted"));
    }

    #[test]
    fn file_actions_and_checkpoint_preserve_changes() {
        let repo = temp_repo();
        std::fs::write(repo.join("a.txt"), "changed").unwrap();
        std::fs::write(repo.join("new.txt"), "new").unwrap();
        let checkpoint = create_checkpoint(repo.to_str().unwrap()).unwrap();
        assert_eq!(checkpoint.files, vec!["new.txt"]);
        assert!(checkpoint.bytes > 0);

        apply_file_action(&GitFileActionRequest {
            workspace_root: repo.to_string_lossy().into(),
            path: "a.txt".into(),
            action: GitFileAction::Stage,
        })
        .unwrap();
        assert!(!git(&repo, &["diff", "--cached", "--name-only"])
            .unwrap()
            .trim()
            .is_empty());
        apply_file_action(&GitFileActionRequest {
            workspace_root: repo.to_string_lossy().into(),
            path: "a.txt".into(),
            action: GitFileAction::Unstage,
        })
        .unwrap();
        apply_file_action(&GitFileActionRequest {
            workspace_root: repo.to_string_lossy().into(),
            path: "a.txt".into(),
            action: GitFileAction::Revert,
        })
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("a.txt")).unwrap(),
            "hello"
        );
        std::fs::remove_file(repo.join("new.txt")).unwrap();
        let preview =
            checkpoint_restore_preview(repo.to_str().unwrap(), &checkpoint.checkpoint_id).unwrap();
        assert!(preview.ready, "{:?}", preview.reason);
        restore_checkpoint(repo.to_str().unwrap(), &checkpoint.checkpoint_id).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("a.txt")).unwrap(),
            "changed"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("new.txt")).unwrap(),
            "new"
        );
    }

    #[test]
    fn hunk_validation_rejects_cross_file_patch() {
        let error = validate_single_file_patch(
            "--- a/a.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-a\n+b\n",
            "a.txt",
        )
        .unwrap_err();
        assert!(error.to_string().contains("requested file"));
    }
}
