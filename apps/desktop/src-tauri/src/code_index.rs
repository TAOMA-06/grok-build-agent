//! Lightweight workspace symbol index for Cursor/Codex parity wave W1-B.
//!
//! Scans text files for definition-like patterns (functions, types, structs,
//! classes, exports) and ranks hits. This is not a full AST indexer — it is a
//! Host-owned fast path that explore workers and the Context drawer can prefer
//! before broad content grep.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_FILES: usize = 4_000;
const MAX_RESULTS: usize = 80;
const MAX_SNIPPET: usize = 160;

#[derive(Debug, Error)]
pub enum CodeIndexError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SymbolHit {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub score: u32,
    pub snippet: String,
}

#[derive(Clone, Copy)]
struct Pattern {
    kind: &'static str,
    /// Captures the symbol name in group 1.
    regex: &'static str,
    base_score: u32,
}

const PATTERNS: &[Pattern] = &[
    Pattern {
        kind: "function",
        regex: r"(?m)^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w']*)",
        base_score: 80,
    },
    Pattern {
        kind: "function",
        regex: r"(?m)^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w']*)",
        base_score: 85,
    },
    Pattern {
        kind: "method",
        regex: r"(?m)^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w']*)\s*\(",
        base_score: 70,
    },
    Pattern {
        kind: "struct",
        regex: r"(?m)^\s*(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w']*)",
        base_score: 90,
    },
    Pattern {
        kind: "enum",
        regex: r"(?m)^\s*(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+([A-Za-z_][\w']*)",
        base_score: 88,
    },
    Pattern {
        kind: "trait",
        regex: r"(?m)^\s*(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+([A-Za-z_][\w']*)",
        base_score: 92,
    },
    Pattern {
        kind: "type",
        regex: r"(?m)^\s*(?:export\s+)?type\s+([A-Za-z_][\w']*)",
        base_score: 86,
    },
    Pattern {
        kind: "class",
        regex: r"(?m)^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w']*)",
        base_score: 90,
    },
    Pattern {
        kind: "interface",
        regex: r"(?m)^\s*(?:export\s+)?interface\s+([A-Za-z_][\w']*)",
        base_score: 88,
    },
    Pattern {
        kind: "const",
        regex: r"(?m)^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_][\w']*)\s*=",
        base_score: 60,
    },
    Pattern {
        kind: "impl",
        regex: r"(?m)^\s*impl(?:\s*<[^>]+>)?\s+(?:[A-Za-z_][\w:<>]*\s+for\s+)?([A-Za-z_][\w']*)",
        base_score: 75,
    },
];

fn skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | "coverage"
            | "__pycache__"
            | ".venv"
            | "venv"
    )
}

fn indexable_extension(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()).unwrap_or(""),
        "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go" | "java"
            | "kt" | "swift" | "cs" | "cpp" | "cc" | "cxx" | "h" | "hpp" | "m" | "mm"
            | "rb" | "php" | "scala" | "toml" | "md"
    )
}

fn line_number_at(content: &str, byte_offset: usize) -> u32 {
    content[..byte_offset.min(content.len())]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count() as u32
        + 1
}

fn snippet_for_line(content: &str, line: u32) -> String {
    content
        .lines()
        .nth(line.saturating_sub(1) as usize)
        .unwrap_or("")
        .trim()
        .chars()
        .take(MAX_SNIPPET)
        .collect()
}

fn score_hit(query: &str, name: &str, base: u32) -> u32 {
    let q = query.to_lowercase();
    let n = name.to_lowercase();
    if n == q {
        base + 40
    } else if n.starts_with(&q) {
        base + 25
    } else if n.contains(&q) {
        base + 10
    } else {
        0
    }
}

/// Search definition-like symbols under `workspace_root`.
pub fn search_symbols(root: &str, query: &str) -> Result<Vec<SymbolHit>, CodeIndexError> {
    let root = canonical_root(root)?;
    let query = query.trim();
    if query.len() < 2 {
        return Ok(Vec::new());
    }
    let compiled: Vec<(Pattern, regex::Regex)> = PATTERNS
        .iter()
        .filter_map(|pattern| {
            regex::Regex::new(pattern.regex)
                .ok()
                .map(|re| (*pattern, re))
        })
        .collect();
    let mut queue = VecDeque::from([root.clone()]);
    let mut visited = 0_usize;
    let mut hits = Vec::new();

    while let Some(directory) = queue.pop_front() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for item in entries {
            if visited >= MAX_FILES || hits.len() >= MAX_RESULTS * 4 {
                break;
            }
            let item = match item {
                Ok(item) => item,
                Err(_) => continue,
            };
            visited += 1;
            let kind = match item.file_type() {
                Ok(kind) => kind,
                Err(_) => continue,
            };
            if kind.is_symlink() {
                continue;
            }
            let path = item.path();
            if kind.is_dir() {
                if item
                    .file_name()
                    .to_str()
                    .is_some_and(skip_dir)
                {
                    continue;
                }
                queue.push_back(path);
                continue;
            }
            if !kind.is_file() || !indexable_extension(&path) {
                continue;
            }
            let metadata = match item.metadata() {
                Ok(metadata) if metadata.len() <= MAX_FILE_BYTES => metadata,
                _ => continue,
            };
            let _ = metadata;
            let bytes = match std::fs::read(&path) {
                Ok(bytes) if !bytes.contains(&0) => bytes,
                _ => continue,
            };
            let content = String::from_utf8_lossy(&bytes);
            let relative = path
                .strip_prefix(&root)
                .map_err(|_| CodeIndexError::Message("workspace path escaped root".into()))?
                .to_string_lossy()
                .replace('\\', "/");

            for (pattern, re) in &compiled {
                for capture in re.captures_iter(&content) {
                    let Some(name) = capture.get(1).map(|m| m.as_str()) else {
                        continue;
                    };
                    let score = score_hit(query, name, pattern.base_score);
                    if score == 0 {
                        continue;
                    }
                    let offset = capture.get(0).map(|m| m.start()).unwrap_or(0);
                    let line = line_number_at(&content, offset);
                    hits.push(SymbolHit {
                        path: relative.clone(),
                        name: name.into(),
                        kind: pattern.kind.into(),
                        line,
                        score,
                        snippet: snippet_for_line(&content, line),
                    });
                }
            }
        }
    }

    hits.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.line.cmp(&right.line))
    });
    hits.dedup_by(|left, right| {
        left.path == right.path && left.name == right.name && left.line == right.line
    });
    hits.truncate(MAX_RESULTS);
    Ok(hits)
}

fn canonical_root(root: &str) -> Result<PathBuf, CodeIndexError> {
    let root = std::fs::canonicalize(root)?;
    if !root.is_dir() {
        return Err(CodeIndexError::Message(
            "workspace root is not a directory".into(),
        ));
    }
    Ok(root)
}

#[allow(dead_code)]
fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, CodeIndexError> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
            && !relative.as_os_str().is_empty()
    {
        return Err(CodeIndexError::Message("unsafe workspace path".into()));
    }
    let resolved = std::fs::canonicalize(root.join(relative))?;
    if !resolved.starts_with(root) {
        return Err(CodeIndexError::Message(
            "workspace path escaped root".into(),
        ));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn temp_workspace() -> PathBuf {
        let path = std::env::temp_dir().join(format!("gbd-index-{}", Uuid::new_v4()));
        fs::create_dir_all(path.join("src")).unwrap();
        path
    }

    #[test]
    fn ranks_exact_trait_and_struct_matches() {
        let root = temp_workspace();
        fs::write(
            root.join("src/adapter.rs"),
            r#"
pub trait RuntimeAdapter {
    fn adapter_id(&self) -> &'static str;
}

pub struct GrokAcpAdapter {
    runtime: String,
}
"#,
        )
        .unwrap();
        let hits = search_symbols(root.to_str().unwrap(), "RuntimeAdapter").unwrap();
        fs::remove_dir_all(&root).ok();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].name, "RuntimeAdapter");
        assert_eq!(hits[0].kind, "trait");
        assert!(hits[0].score >= 90);
    }

    #[test]
    fn finds_typescript_exports() {
        let root = temp_workspace();
        fs::write(
            root.join("src/subagent.ts"),
            r#"
export type SubagentRecord = { id: string };
export function summarizeSubagentFleet() { return null; }
"#,
        )
        .unwrap();
        let hits = search_symbols(root.to_str().unwrap(), "summarizeSubagent").unwrap();
        fs::remove_dir_all(&root).ok();
        assert!(hits.iter().any(|hit| hit.name == "summarizeSubagentFleet"));
    }

    #[test]
    fn ignores_tiny_queries() {
        let root = temp_workspace();
        assert!(search_symbols(root.to_str().unwrap(), "a").unwrap().is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
