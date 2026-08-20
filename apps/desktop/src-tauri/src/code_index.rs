//! Lightweight workspace symbol index for Cursor/Codex parity wave W1-B / W1-B+.
//!
//! Scans text files for definition-like patterns (functions, types, structs,
//! classes, exports) and identifier usages (call / reference). This is not a
//! full AST or persistent codegraph — it is a Host-owned fast path that explore
//! workers and the Context drawer can prefer before broad content grep.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use thiserror::Error;

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_FILES: usize = 4_000;
const MAX_RESULTS: usize = 80;
const MAX_SNIPPET: usize = 160;
const DEF_CACHE_VERSION: u32 = 1;
const DEF_CACHE_RELATIVE: &str = ".grok/cache/symbol-defs-v1.json";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedDef {
    name: String,
    kind: String,
    line: u32,
    base_score: u32,
    snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedFile {
    mtime_ms: u64,
    len: u64,
    defs: Vec<CachedDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DefCache {
    version: u32,
    files: HashMap<String, CachedFile>,
}

fn cache_path(root: &Path) -> PathBuf {
    root.join(DEF_CACHE_RELATIVE)
}

fn file_fingerprint(meta: &std::fs::Metadata) -> (u64, u64) {
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    (mtime_ms, meta.len())
}

fn load_def_cache(root: &Path) -> DefCache {
    let bytes = match std::fs::read(cache_path(root)) {
        Ok(bytes) => bytes,
        Err(_) => return DefCache::default(),
    };
    match serde_json::from_slice::<DefCache>(&bytes) {
        Ok(cache) if cache.version == DEF_CACHE_VERSION => cache,
        _ => DefCache::default(),
    }
}

fn save_def_cache(root: &Path, cache: &DefCache) {
    let path = cache_path(root);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(cache) {
        let _ = std::fs::write(path, bytes);
    }
}

fn extract_defs(
    content: &str,
    compiled: &[(Pattern, regex::Regex)],
) -> Vec<CachedDef> {
    let mut defs = Vec::new();
    for (pattern, re) in compiled {
        for capture in re.captures_iter(content) {
            let Some(name) = capture.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let offset = capture.get(0).map(|m| m.start()).unwrap_or(0);
            let line = line_number_at(content, offset);
            defs.push(CachedDef {
                name: name.into(),
                kind: pattern.kind.into(),
                line,
                base_score: pattern.base_score,
                snippet: snippet_for_line(content, line),
            });
        }
    }
    defs.sort_by(|left, right| {
        left.line
            .cmp(&right.line)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.kind.cmp(&right.kind))
    });
    defs.dedup_by(|left, right| {
        left.line == right.line && left.name == right.name && left.kind == right.kind
    });
    defs
}

/// Rebuild or refresh the on-disk definition cache under `.grok/cache/`.
/// Returns every cached definition (path attached) for query ranking.
/// When `force` is true, ignore mtime hits and reparse every indexable file.
fn collect_cached_defs(root: &Path, force: bool) -> Result<Vec<(String, CachedDef)>, CodeIndexError> {
    let compiled: Vec<(Pattern, regex::Regex)> = PATTERNS
        .iter()
        .filter_map(|pattern| {
            regex::Regex::new(pattern.regex)
                .ok()
                .map(|re| (*pattern, re))
        })
        .collect();
    let mut cache = if force {
        DefCache {
            version: DEF_CACHE_VERSION,
            files: HashMap::new(),
        }
    } else {
        load_def_cache(root)
    };
    let mut next_files = HashMap::new();
    let mut dirty = force || cache.version != DEF_CACHE_VERSION || cache.files.is_empty();
    cache.version = DEF_CACHE_VERSION;

    let mut queue = VecDeque::from([root.to_path_buf()]);
    let mut visited = 0_usize;
    let mut all = Vec::new();

    while let Some(directory) = queue.pop_front() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for item in entries {
            if visited >= MAX_FILES {
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
                if item.file_name().to_str().is_some_and(skip_dir) {
                    continue;
                }
                // Keep scanning under .grok except the cache dir itself.
                if item.file_name().to_str() == Some("cache")
                    && directory.ends_with(".grok")
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
            let (mtime_ms, len) = file_fingerprint(&metadata);
            let relative = path
                .strip_prefix(root)
                .map_err(|_| CodeIndexError::Message("workspace path escaped root".into()))?
                .to_string_lossy()
                .replace('\\', "/");

            let reused = if force {
                None
            } else {
                cache.files.get(&relative).and_then(|cached| {
                    if cached.mtime_ms == mtime_ms && cached.len == len {
                        Some(cached.clone())
                    } else {
                        None
                    }
                })
            };
            let file = if let Some(cached) = reused {
                cached
            } else {
                dirty = true;
                let bytes = match std::fs::read(&path) {
                    Ok(bytes) if !bytes.contains(&0) => bytes,
                    _ => continue,
                };
                let content = String::from_utf8_lossy(&bytes);
                CachedFile {
                    mtime_ms,
                    len,
                    defs: extract_defs(&content, &compiled),
                }
            };
            for def in &file.defs {
                all.push((relative.clone(), def.clone()));
            }
            next_files.insert(relative, file);
        }
    }

    if dirty || next_files.len() != cache.files.len() {
        cache.files = next_files;
        save_def_cache(root, &cache);
    }
    Ok(all)
}

/// Search definition-like symbols under `workspace_root`.
///
/// Uses a durable per-workspace cache at `.grok/cache/symbol-defs-v1.json`
/// invalidated by file mtime + size. Still not a typed AST / call graph.
pub fn search_symbols(root: &str, query: &str) -> Result<Vec<SymbolHit>, CodeIndexError> {
    let root = canonical_root(root)?;
    let query = query.trim();
    if query.len() < 2 {
        return Ok(Vec::new());
    }
    let defs = collect_cached_defs(&root, false)?;
    let mut hits = Vec::new();
    for (path, def) in defs {
        let score = score_hit(query, &def.name, def.base_score);
        if score == 0 {
            continue;
        }
        hits.push(SymbolHit {
            path,
            name: def.name,
            kind: def.kind,
            line: def.line,
            score,
            snippet: def.snippet,
        });
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

fn is_identifier_query(query: &str) -> bool {
    let mut chars = query.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {
            chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '\'')
        }
        _ => false,
    }
}

fn looks_like_definition(line: &str, name: &str) -> bool {
    let trimmed = line.trim_start();
    let patterns = [
        format!("fn {name}"),
        format!("function {name}"),
        format!("struct {name}"),
        format!("enum {name}"),
        format!("trait {name}"),
        format!("type {name}"),
        format!("class {name}"),
        format!("interface {name}"),
        format!("const {name}"),
        format!("let {name}"),
    ];
    if patterns.iter().any(|needle| trimmed.contains(needle.as_str())) {
        return true;
    }
    trimmed.starts_with("impl") && trimmed.contains(name)
}

fn classify_reference(line: &str, name: &str) -> &'static str {
    let call = format!("{name}(");
    let path = format!("{name}::");
    let method = format!(".{name}(");
    let member = format!(".{name}");
    let import_like = trimmed_starts_with_import(line);
    if line.contains(&call) || line.contains(&method) || line.contains(&path) {
        if import_like {
            "import"
        } else {
            "call"
        }
    } else if import_like {
        "import"
    } else if line.contains(&member) || line.contains(&format!("::{name}")) {
        "reference"
    } else {
        "reference"
    }
}

fn trimmed_starts_with_import(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("use ")
        || trimmed.starts_with("import ")
        || trimmed.starts_with("from ")
        || trimmed.starts_with("require(")
}

/// Search identifier usages (calls / references), excluding definition lines.
///
/// Honest MVP: word-boundary text scan ranked by call-like shape — not a typed
/// call graph or persistent AST index.
pub fn search_references(root: &str, query: &str) -> Result<Vec<SymbolHit>, CodeIndexError> {
    let root = canonical_root(root)?;
    let query = query.trim();
    if query.len() < 2 || !is_identifier_query(query) {
        return Ok(Vec::new());
    }
    let word_re = regex::Regex::new(&format!(
        r"(?m)\b{}\b",
        regex::escape(query)
    ))
    .map_err(|error| CodeIndexError::Message(error.to_string()))?;

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
                if item.file_name().to_str().is_some_and(skip_dir) {
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

            for capture in word_re.find_iter(&content) {
                let line = line_number_at(&content, capture.start());
                let snippet = snippet_for_line(&content, line);
                if looks_like_definition(&snippet, query) {
                    continue;
                }
                let kind = classify_reference(&snippet, query);
                let base = match kind {
                    "call" => 88,
                    "import" => 55,
                    _ => 65,
                };
                hits.push(SymbolHit {
                    path: relative.clone(),
                    name: query.into(),
                    kind: kind.into(),
                    line,
                    score: base,
                    snippet,
                });
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallGraphSlice {
    pub symbol: String,
    pub definitions: Vec<SymbolHit>,
    pub callers: Vec<SymbolHit>,
}

/// Combine definition + reference hits into a lightweight call-graph slice.
/// Text-ranked, not a typed AST edge set.
pub fn search_call_graph(root: &str, query: &str) -> Result<CallGraphSlice, CodeIndexError> {
    let symbol = query.trim().to_string();
    Ok(CallGraphSlice {
        symbol: symbol.clone(),
        definitions: search_symbols(root, &symbol)?,
        callers: search_references(root, &symbol)?,
    })
}

/// Drop cached definition entries (all, or selected relative paths) so the next
/// search reparses those files. Acts as an explicit invalidate / "watcher" hook
/// without embedding a long-lived filesystem watcher in the Host.
pub fn invalidate_symbol_cache(
    root: &str,
    paths: Option<&[String]>,
) -> Result<u32, CodeIndexError> {
    let root = canonical_root(root)?;
    let mut cache = load_def_cache(&root);
    let removed = if let Some(paths) = paths {
        let mut count = 0_u32;
        for path in paths {
            let key = path.trim().trim_start_matches("./").replace('\\', "/");
            if key.is_empty() {
                continue;
            }
            if cache.files.remove(&key).is_some() {
                count += 1;
            }
        }
        count
    } else {
        let count = cache.files.len() as u32;
        cache.files.clear();
        count
    };
    cache.version = DEF_CACHE_VERSION;
    save_def_cache(&root, &cache);
    Ok(removed)
}

/// Force a full definition-cache rebuild and return how many defs were indexed.
pub fn rebuild_symbol_cache(root: &str) -> Result<u32, CodeIndexError> {
    let root = canonical_root(root)?;
    let defs = collect_cached_defs(&root, true)?;
    Ok(defs.len() as u32)
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

    #[test]
    fn persists_definition_cache_under_grok() {
        let root = temp_workspace();
        fs::write(
            root.join("src/cache_me.rs"),
            "pub fn CachedSymbol() {}\n",
        )
        .unwrap();
        let first = search_symbols(root.to_str().unwrap(), "CachedSymbol").unwrap();
        assert!(!first.is_empty());
        let cache = root.join(".grok/cache/symbol-defs-v1.json");
        assert!(cache.is_file(), "expected durable def cache");
        let second = search_symbols(root.to_str().unwrap(), "CachedSymbol").unwrap();
        assert_eq!(first[0].name, second[0].name);
        assert_eq!(first[0].line, second[0].line);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn invalidate_and_rebuild_refresh_cache() {
        let root = temp_workspace();
        fs::write(root.join("src/a.rs"), "pub fn AlphaSymbol() {}\n").unwrap();
        let _ = search_symbols(root.to_str().unwrap(), "AlphaSymbol").unwrap();
        assert!(root.join(".grok/cache/symbol-defs-v1.json").is_file());
        let removed = invalidate_symbol_cache(root.to_str().unwrap(), None).unwrap();
        assert!(removed >= 1);
        let rebuilt = rebuild_symbol_cache(root.to_str().unwrap()).unwrap();
        assert!(rebuilt >= 1);
        let graph = search_call_graph(root.to_str().unwrap(), "AlphaSymbol").unwrap();
        assert!(!graph.definitions.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn finds_call_sites_excluding_definition() {
        let root = temp_workspace();
        fs::write(
            root.join("src/lib.rs"),
            r#"
pub fn RuntimeAdapter() {}

fn boot() {
    let _ = RuntimeAdapter();
}
"#,
        )
        .unwrap();
        fs::write(
            root.join("src/caller.ts"),
            r#"
import { RuntimeAdapter } from "./lib";
export function boot() {
  return RuntimeAdapter();
}
"#,
        )
        .unwrap();
        let hits = search_references(root.to_str().unwrap(), "RuntimeAdapter").unwrap();
        fs::remove_dir_all(&root).ok();
        assert!(hits.iter().any(|hit| hit.kind == "call"));
        assert!(hits.iter().all(|hit| hit.kind != "function" && hit.kind != "trait"));
        assert!(!hits.iter().any(|hit| hit.snippet.contains("pub fn RuntimeAdapter")));
    }

    #[test]
    fn references_reject_non_identifiers() {
        let root = temp_workspace();
        assert!(search_references(root.to_str().unwrap(), "foo.bar").unwrap().is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
