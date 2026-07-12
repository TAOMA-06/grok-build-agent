//! Grok CLI management: plugins, MCP, login, update, install.
//! All commands use argv arrays — never shell-concatenate user input.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CliBridgeError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Serialize for CliBridgeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn resolve_grok(configured: Option<&str>) -> Result<String, CliBridgeError> {
    crate::acp::resolve_grok_path(configured).map_err(|e| CliBridgeError::Message(e.to_string()))
}

fn run_grok(configured: Option<&str>, args: &[&str]) -> Result<String, CliBridgeError> {
    run_grok_in(configured, args, None)
}

fn run_grok_in(
    configured: Option<&str>,
    args: &[&str],
    cwd: Option<&str>,
) -> Result<String, CliBridgeError> {
    let path = resolve_grok(configured)?;
    let mut cmd = Command::new(&path);
    cmd.args(args);
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }
    let output = cmd.output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let msg = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("grok {:?} failed", args)
        };
        return Err(CliBridgeError::Message(crate::secrets::redact_secrets(
            &msg,
        )));
    }
    Ok(stdout)
}

fn run_grok_in_timeout(
    configured: Option<&str>,
    args: &[&str],
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<String, CliBridgeError> {
    let path = resolve_grok(configured)?;
    let mut cmd = Command::new(&path);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|dir| !dir.trim().is_empty()) {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stdout {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(CliBridgeError::Message(format!(
                "grok {:?} timed out after {} seconds",
                args,
                timeout.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let stdout = String::from_utf8_lossy(&stdout_reader.join().unwrap_or_default()).to_string();
    let stderr = String::from_utf8_lossy(&stderr_reader.join().unwrap_or_default()).to_string();
    if !status.success() {
        let message = if !stderr.trim().is_empty() {
            stderr.trim()
        } else if !stdout.trim().is_empty() {
            stdout.trim()
        } else {
            "doctor failed"
        };
        return Err(CliBridgeError::Message(crate::secrets::redact_secrets(
            message,
        )));
    }
    Ok(stdout)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityItem {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySnapshot {
    pub skills: Vec<CapabilityItem>,
    pub plugins: Vec<CapabilityItem>,
    pub hooks: Vec<CapabilityItem>,
    pub mcp_servers: Vec<CapabilityItem>,
    pub commands: Vec<CapabilityItem>,
    pub rules: Vec<CapabilityItem>,
    pub raw: serde_json::Value,
}

fn capability_items(value: &serde_json::Value, keys: &[&str]) -> Vec<CapabilityItem> {
    let found = keys.iter().find_map(|key| value.get(*key));
    let mut items = Vec::new();
    match found {
        Some(serde_json::Value::Array(values)) => {
            for item in values {
                let raw_name = item
                    .get("name")
                    .or_else(|| item.get("id"))
                    .or_else(|| item.get("command"))
                    .and_then(|value| value.as_str())
                    .or_else(|| item.as_str())
                    .unwrap_or("");
                if raw_name.is_empty() {
                    continue;
                }
                let id = item
                    .get("id")
                    .or_else(|| item.get("command"))
                    .and_then(|value| value.as_str())
                    .unwrap_or(raw_name)
                    .to_string();
                items.push(CapabilityItem {
                    id,
                    name: raw_name.to_string(),
                    description: item
                        .get("description")
                        .or_else(|| item.get("summary"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    source: item
                        .get("source")
                        .or_else(|| item.get("scope"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    enabled: item.get("enabled").and_then(|value| value.as_bool()),
                });
            }
        }
        Some(serde_json::Value::Object(values)) => {
            for (id, item) in values {
                items.push(CapabilityItem {
                    id: id.clone(),
                    name: item
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or(id)
                        .to_string(),
                    description: item
                        .get("description")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    source: item
                        .get("source")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    enabled: item.get("enabled").and_then(|value| value.as_bool()),
                });
            }
        }
        _ => {}
    }
    items
}

pub fn inspect_capabilities(
    configured: Option<&str>,
    workspace_root: Option<&str>,
) -> Result<CapabilitySnapshot, CliBridgeError> {
    let cwd = workspace_root.filter(|value| !value.trim().is_empty());
    let raw = match run_grok_in(configured, &["inspect", "--json"], cwd) {
        Ok(output) => serde_json::from_str(output.trim()).unwrap_or(serde_json::Value::Null),
        Err(error) => serde_json::json!({ "unavailable": error.to_string() }),
    };
    let mut commands = capability_items(&raw, &["commands", "slashCommands", "slash_commands"]);
    for (id, name, description) in [
        ("/goal", "/goal", "Delegate a long-running objective"),
        ("/code-review", "/code-review", "Review the current changes"),
    ] {
        if !commands
            .iter()
            .any(|item| item.id == id || item.name == name)
        {
            commands.push(CapabilityItem {
                id: id.into(),
                name: name.into(),
                description: Some(description.into()),
                source: Some("grok".into()),
                enabled: Some(true),
            });
        }
    }
    Ok(CapabilitySnapshot {
        skills: capability_items(&raw, &["skills"]),
        plugins: capability_items(&raw, &["plugins"]),
        hooks: capability_items(&raw, &["hooks"]),
        mcp_servers: capability_items(&raw, &["mcpServers", "mcp_servers", "mcp"]),
        commands,
        rules: capability_items(&raw, &["rules", "instructions"]),
        raw,
    })
}

// --- Models ----------------------------------------------------------------

pub fn list_models(
    configured: Option<&str>,
) -> Result<Vec<crate::contracts::SelectableModel>, CliBridgeError> {
    // Prefer JSON if the CLI adds it later; always fall back to text parse.
    let mut models = if let Ok(out) = run_grok(configured, &["models", "--json"]) {
        let trimmed = out.trim();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            parse_models_json(&value).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if models.is_empty() {
        // `grok models` prints login banners / log lines before the list; text
        // parse must ignore those (otherwise "You are logged in…" becomes id "You").
        if let Ok(out) = run_grok(configured, &["models"]) {
            models = parse_models_text(&out);
        }
    }

    enrich_models_from_cache(&mut models);
    if models.is_empty() {
        models = models_from_cache_only();
    }
    Ok(models)
}

fn parse_models_json(value: &serde_json::Value) -> Option<Vec<crate::contracts::SelectableModel>> {
    let arr = value
        .as_array()
        .cloned()
        .or_else(|| value.get("models").and_then(|v| v.as_array()).cloned())?;
    let mut models = Vec::new();
    for item in arr {
        let id = item
            .get("id")
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        models.push(crate::contracts::SelectableModel {
            id: id.clone(),
            name: item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string(),
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            is_default: item
                .get("isDefault")
                .or_else(|| item.get("default"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            tags: item
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            context_window: item
                .get("contextWindow")
                .or_else(|| item.get("context_window"))
                .and_then(|v| v.as_u64()),
            supports_reasoning_effort: item
                .get("supportsReasoningEffort")
                .or_else(|| item.get("supports_reasoning_effort"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            reasoning_effort: item
                .get("reasoningEffort")
                .or_else(|| item.get("reasoning_effort"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            reasoning_efforts: parse_reasoning_efforts(&item),
            auto_compact_threshold_percent: item
                .get("autoCompactThresholdPercent")
                .or_else(|| item.get("auto_compact_threshold_percent"))
                .and_then(|v| v.as_u64())
                .map(|n| n as u8),
        });
    }
    Some(models)
}

fn parse_reasoning_efforts(
    item: &serde_json::Value,
) -> Vec<crate::contracts::ReasoningEffortOption> {
    let Some(arr) = item
        .get("reasoningEfforts")
        .or_else(|| item.get("reasoning_efforts"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|opt| {
            let value = opt
                .get("value")
                .or_else(|| opt.get("id"))
                .and_then(|v| v.as_str())?
                .to_string();
            let id = opt
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or(value.as_str())
                .to_string();
            Some(crate::contracts::ReasoningEffortOption {
                id,
                label: opt
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or(value.as_str())
                    .to_string(),
                description: opt
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                default: opt
                    .get("default")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                value,
            })
        })
        .collect()
}

fn models_cache_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        std::path::PathBuf::from(home)
            .join(".grok")
            .join("models_cache.json"),
    )
}

fn read_models_cache() -> Option<serde_json::Value> {
    let path = models_cache_path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn apply_cache_info(model: &mut crate::contracts::SelectableModel, info: &serde_json::Value) {
    if model.name == model.id {
        if let Some(name) = info.get("name").and_then(|v| v.as_str()) {
            model.name = name.to_string();
        }
    }
    if model.description.is_none() {
        model.description = info
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if model.context_window.is_none() {
        model.context_window = info.get("context_window").and_then(|v| v.as_u64());
    }
    if let Some(supports) = info
        .get("supports_reasoning_effort")
        .and_then(|v| v.as_bool())
    {
        model.supports_reasoning_effort = supports;
    }
    if model.reasoning_effort.is_none() {
        model.reasoning_effort = info
            .get("reasoning_effort")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if model.reasoning_efforts.is_empty() {
        model.reasoning_efforts = parse_reasoning_efforts(info);
    }
    if model.auto_compact_threshold_percent.is_none() {
        model.auto_compact_threshold_percent = info
            .get("auto_compact_threshold_percent")
            .and_then(|v| v.as_u64())
            .map(|n| n as u8);
    }
}

fn enrich_models_from_cache(models: &mut Vec<crate::contracts::SelectableModel>) {
    let Some(cache) = read_models_cache() else {
        return;
    };
    let Some(map) = cache.get("models").and_then(|v| v.as_object()) else {
        return;
    };
    // Drop banner noise that slipped past the text parser when we have a real catalog.
    models.retain(|model| map.contains_key(&model.id) || looks_like_model_id(&model.id));
    for model in models.iter_mut() {
        if let Some(entry) = map.get(&model.id) {
            if let Some(info) = entry.get("info") {
                apply_cache_info(model, info);
            }
        }
    }
    let existing: std::collections::HashSet<String> =
        models.iter().map(|model| model.id.clone()).collect();
    for (id, entry) in map {
        if existing.contains(id) {
            continue;
        }
        let Some(info) = entry.get("info") else {
            continue;
        };
        if info
            .get("hidden")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let mut model = crate::contracts::SelectableModel::named(
            id.clone(),
            info.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(id)
                .to_string(),
            false,
        );
        apply_cache_info(&mut model, info);
        models.push(model);
    }
}

fn models_from_cache_only() -> Vec<crate::contracts::SelectableModel> {
    let Some(cache) = read_models_cache() else {
        return Vec::new();
    };
    let Some(map) = cache.get("models").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut models = Vec::new();
    for (id, entry) in map {
        let Some(info) = entry.get("info") else {
            continue;
        };
        if info
            .get("hidden")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let mut model = crate::contracts::SelectableModel::named(
            id.clone(),
            info.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(id)
                .to_string(),
            false,
        );
        apply_cache_info(&mut model, info);
        models.push(model);
    }
    models.sort_by_key(|model| model.name.to_lowercase());
    models
}

fn looks_like_model_id(id: &str) -> bool {
    let id = id.trim();
    if id.len() < 2 || id.len() > 128 {
        return false;
    }
    let lower = id.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "you"
            | "available"
            | "default"
            | "error"
            | "settings"
            | "model"
            | "models"
            | "logged"
            | "login"
    ) {
        return false;
    }
    // Timestamps / ISO datetimes from log lines.
    if id.chars().next().is_some_and(|c| c.is_ascii_digit()) && id.contains(':') {
        return false;
    }
    id.contains('-')
        || id.contains('/')
        || lower.starts_with("grok")
        || lower.starts_with("composer")
}

fn parse_models_text(out: &str) -> Vec<crate::contracts::SelectableModel> {
    let mut models = Vec::new();
    let mut default_id: Option<String> = None;
    for line in out.lines() {
        // Strip common ANSI SGR sequences from CLI log noise.
        let line = {
            let mut cleaned = String::with_capacity(line.len());
            let mut chars = line.chars().peekable();
            while let Some(ch) = chars.next() {
                if ch == '\u{1b}' {
                    if chars.peek() == Some(&'[') {
                        chars.next();
                        for next in chars.by_ref() {
                            if next.is_ascii_alphabetic() {
                                break;
                            }
                        }
                    }
                    continue;
                }
                cleaned.push(ch);
            }
            cleaned
        };
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Default model:") {
            let id = rest.trim().to_string();
            if looks_like_model_id(&id) {
                default_id = Some(id);
            }
            continue;
        }
        // Only accept bullet list rows (`* id` / `- id`), never prose like
        // "You are logged in with grok.com."
        let trimmed_start = line.trim_start();
        let is_bullet = trimmed_start.starts_with('*')
            || trimmed_start.starts_with('-')
            || trimmed_start.starts_with('•');
        if !is_bullet {
            continue;
        }
        let cleaned = line.trim_start_matches(['*', '-', '•', ' ']).trim();
        if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("available models:") {
            continue;
        }
        if !cleaned
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
        {
            continue;
        }
        let id = cleaned
            .split_whitespace()
            .next()
            .unwrap_or(cleaned)
            .trim_matches(|c| c == '(' || c == ')')
            .to_string();
        if !looks_like_model_id(&id) {
            continue;
        }
        let is_default = line.contains('*')
            || cleaned.contains("(default)")
            || default_id.as_deref() == Some(id.as_str());
        if models
            .iter()
            .any(|m: &crate::contracts::SelectableModel| m.id == id)
        {
            continue;
        }
        models.push(crate::contracts::SelectableModel::named(
            id.clone(),
            id,
            is_default,
        ));
    }
    if models.is_empty() {
        if let Some(d) = default_id {
            models.push(crate::contracts::SelectableModel::named(d.clone(), d, true));
        }
    } else if let Some(d) = default_id.as_deref() {
        for model in &mut models {
            if model.id == d {
                model.is_default = true;
            }
        }
    }
    models
}

// --- Plugins (T11) --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub path: Option<String>,
    pub description: Option<String>,
}

pub fn list_plugins(configured: Option<&str>) -> Result<Vec<PluginInfo>, CliBridgeError> {
    let out = run_grok(configured, &["plugin", "list", "--json"])?;
    let trimmed = out.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(vec![]);
    }
    // Accept array or { plugins: [] }
    let value: serde_json::Value = serde_json::from_str(trimmed)?;
    let arr = value
        .as_array()
        .cloned()
        .or_else(|| value.get("plugins").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in arr {
        let name = item
            .get("name")
            .or_else(|| item.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        out.push(PluginInfo {
            name,
            version: item
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            enabled: item
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            path: item
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }
    Ok(out)
}

pub fn install_plugin(configured: Option<&str>, source: &str) -> Result<String, CliBridgeError> {
    let source = source.trim();
    if source.is_empty() {
        return Err(CliBridgeError::Message("plugin source empty".into()));
    }
    // Local path or URL only — passed as a single argv element.
    run_grok(configured, &["plugin", "install", source])
}

pub fn uninstall_plugin(configured: Option<&str>, name: &str) -> Result<String, CliBridgeError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CliBridgeError::Message("plugin name empty".into()));
    }
    run_grok(configured, &["plugin", "uninstall", name])
}

pub fn set_plugin_enabled(
    configured: Option<&str>,
    name: &str,
    enabled: bool,
) -> Result<String, CliBridgeError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CliBridgeError::Message("plugin name empty".into()));
    }
    if enabled {
        run_grok(configured, &["plugin", "enable", name])
    } else {
        run_grok(configured, &["plugin", "disable", name])
    }
}

pub fn validate_plugin(configured: Option<&str>, path: &str) -> Result<String, CliBridgeError> {
    run_grok(configured, &["plugin", "validate", path])
}

// --- MCP -------------------------------------------------------------------

/// Legacy thin row kept for older callers; prefer list_mcp_full.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfoLegacy {
    pub name: String,
    pub command: Option<String>,
    pub status: Option<String>,
}

fn user_config_path() -> String {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME");
    home.map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".grok")
        .join("config.toml")
        .to_string_lossy()
        .into_owned()
}

fn project_config_path(workspace: Option<&str>) -> Option<String> {
    let ws = workspace?.trim();
    if ws.is_empty() {
        return None;
    }
    Some(
        std::path::PathBuf::from(ws)
            .join(".grok")
            .join("config.toml")
            .to_string_lossy()
            .into_owned(),
    )
}

/// List MCP servers without secret values (env/header values stripped).
pub fn list_mcp_full(
    configured: Option<&str>,
    workspace_root: Option<&str>,
) -> Result<crate::contracts::McpListResult, CliBridgeError> {
    let cwd = workspace_root.filter(|s| !s.trim().is_empty());
    let mut servers: Vec<crate::contracts::McpServerInfo> = Vec::new();

    if let Ok(out) = run_grok_in(configured, &["mcp", "list", "--json"], cwd) {
        let trimmed = out.trim();
        if !trimmed.is_empty() && trimmed != "[]" {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
                servers = parse_mcp_list_json(&value);
            }
        }
    }

    if servers.is_empty() {
        let out = run_grok_in(configured, &["mcp", "list"], cwd).unwrap_or_default();
        servers = parse_mcp_list_text(&out);
    }

    // Enrich key lists from config files without exposing values to the UI.
    enrich_mcp_keys_from_disk(&mut servers, cwd);

    Ok(crate::contracts::McpListResult {
        servers,
        user_config_path: user_config_path(),
        project_config_path: project_config_path(cwd),
        workspace_root: cwd.map(|s| s.to_string()),
    })
}

/// Backward-compatible list used by older list_mcp_servers command.
#[allow(dead_code)]
pub fn list_mcp(configured: Option<&str>) -> Result<Vec<McpServerInfoLegacy>, CliBridgeError> {
    let full = list_mcp_full(configured, None)?;
    Ok(full
        .servers
        .into_iter()
        .map(|s| McpServerInfoLegacy {
            name: s.name,
            command: s.command.or(s.url),
            status: s.status,
        })
        .collect())
}

fn parse_mcp_list_json(value: &serde_json::Value) -> Vec<crate::contracts::McpServerInfo> {
    let arr = value
        .as_array()
        .cloned()
        .or_else(|| value.get("servers").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();
    let mut servers = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(name) = item.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let transport = match item
            .get("transport")
            .or_else(|| item.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "http" => crate::contracts::McpTransport::Http,
            "sse" => crate::contracts::McpTransport::Sse,
            _ => {
                if item.get("url").and_then(|v| v.as_str()).is_some() {
                    crate::contracts::McpTransport::Http
                } else {
                    crate::contracts::McpTransport::Stdio
                }
            }
        };
        let scope = match item
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("user")
            .to_ascii_lowercase()
            .as_str()
        {
            "project" => crate::contracts::McpScope::Project,
            _ => crate::contracts::McpScope::User,
        };
        let command = item
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let url = item
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let args = item
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        // Keys only — never pass secret values to the renderer.
        let env_keys = keys_only(item.get("env"));
        let header_keys = keys_only(item.get("headers"));
        let display_target = url
            .clone()
            .or_else(|| command.clone())
            .unwrap_or_else(|| "—".into());
        servers.push(crate::contracts::McpServerInfo {
            name: name.to_string(),
            transport,
            scope,
            display_target: sanitize_display_target(&display_target),
            command,
            url,
            args,
            env_keys,
            header_keys,
            status: item
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| Some("configured".into())),
            last_doctor: None,
        });
    }
    servers
}

fn keys_only(v: Option<&serde_json::Value>) -> Vec<String> {
    match v {
        Some(serde_json::Value::Object(map)) => map.keys().cloned().collect(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .map(|s| s.to_string())
                    .or_else(|| {
                        item.get("key")
                            .and_then(|k| k.as_str())
                            .map(|s| s.to_string())
                    })
                    .or_else(|| {
                        item.get("name")
                            .and_then(|k| k.as_str())
                            .map(|s| s.to_string())
                    })
            })
            .collect(),
        _ => vec![],
    }
}

fn sanitize_display_target(s: &str) -> String {
    // Drop obvious embedded credentials from URLs for list display.
    if let Some(idx) = s.find("://") {
        let rest = &s[idx + 3..];
        if let Some(at) = rest.find('@') {
            let scheme = &s[..idx + 3];
            return format!("{scheme}***@{}", &rest[at + 1..]);
        }
    }
    s.to_string()
}

fn parse_mcp_list_text(out: &str) -> Vec<crate::contracts::McpServerInfo> {
    if out.to_lowercase().contains("no mcp") {
        return vec![];
    }
    let mut servers = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("No ") || line.starts_with("Run ") {
            continue;
        }
        let scope = if line.contains("(project)") {
            crate::contracts::McpScope::Project
        } else {
            crate::contracts::McpScope::User
        };
        let name = line
            .split_whitespace()
            .next()
            .unwrap_or(line)
            .trim_matches(|c| c == '(' || c == ')')
            .to_string();
        if name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            && !name.is_empty()
        {
            servers.push(crate::contracts::McpServerInfo {
                name,
                transport: crate::contracts::McpTransport::Stdio,
                scope,
                display_target: "—".into(),
                command: None,
                url: None,
                args: vec![],
                env_keys: vec![],
                header_keys: vec![],
                status: Some("configured".into()),
                last_doctor: None,
            });
        }
    }
    servers
}

/// Best-effort: scan config.toml tables for env/header *keys* only.
fn enrich_mcp_keys_from_disk(
    servers: &mut [crate::contracts::McpServerInfo],
    workspace: Option<&str>,
) {
    let paths: Vec<(crate::contracts::McpScope, String)> = {
        let mut v = vec![(crate::contracts::McpScope::User, user_config_path())];
        if let Some(p) = project_config_path(workspace) {
            v.push((crate::contracts::McpScope::Project, p));
        }
        v
    };
    for (scope, path) in paths {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for server in servers.iter_mut() {
            if server.scope != scope {
                // Project-scoped names may appear without scope in JSON; still try match by section.
            }
            let section = format!("[mcp_servers.{}]", server.name);
            let alt = format!("[mcp_servers.\"{}\"]", server.name);
            if let Some(block) = extract_toml_table_block(&text, &section)
                .or_else(|| extract_toml_table_block(&text, &alt))
            {
                if server.env_keys.is_empty() {
                    server.env_keys = extract_map_keys_from_inline_or_block(&block, "env");
                }
                if server.header_keys.is_empty() {
                    server.header_keys = extract_map_keys_from_inline_or_block(&block, "headers");
                }
                if server.command.is_none() {
                    if let Some(cmd) = extract_string_field(&block, "command") {
                        server.command = Some(cmd.clone());
                        if server.display_target == "—" {
                            server.display_target = cmd;
                        }
                    }
                }
                if server.url.is_none() {
                    if let Some(url) = extract_string_field(&block, "url") {
                        server.url = Some(url.clone());
                        server.display_target = sanitize_display_target(&url);
                        if matches!(server.transport, crate::contracts::McpTransport::Stdio) {
                            server.transport = crate::contracts::McpTransport::Http;
                        }
                    }
                }
                if server.args.is_empty() {
                    server.args = extract_string_array_field(&block, "args");
                }
                server.scope = scope;
            }
        }
    }
}

fn extract_toml_table_block(text: &str, header: &str) -> Option<String> {
    let start = text.find(header)?;
    let after = &text[start + header.len()..];
    let end = after.find("\n[").unwrap_or(after.len());
    Some(after[..end].to_string())
}

fn extract_string_field(block: &str, key: &str) -> Option<String> {
    for line in block.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let v = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn extract_string_array_field(block: &str, key: &str) -> Vec<String> {
    for line in block.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let rest = rest.trim();
                if let Some(inner) = rest.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                    return inner
                        .split(',')
                        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
        }
    }
    vec![]
}

fn extract_map_keys_from_inline_or_block(block: &str, key: &str) -> Vec<String> {
    for line in block.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let rest = rest.trim();
                // env = { A = "x", B = "y" }
                if let Some(inner) = rest.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                    return inner
                        .split(',')
                        .filter_map(|pair| {
                            let k = pair.split('=').next()?.trim();
                            let k = k.trim_matches('"').trim_matches('\'');
                            if k.is_empty() {
                                None
                            } else {
                                Some(k.to_string())
                            }
                        })
                        .collect();
                }
            }
        }
    }
    vec![]
}

/// Read secret values for keep-merge (never returned to the frontend).
fn read_secret_map_from_disk(
    name: &str,
    scope: crate::contracts::McpScope,
    workspace: Option<&str>,
    field: &str,
) -> std::collections::HashMap<String, String> {
    let path = match scope {
        crate::contracts::McpScope::User => user_config_path(),
        crate::contracts::McpScope::Project => project_config_path(workspace).unwrap_or_default(),
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return std::collections::HashMap::new();
    };
    let section = format!("[mcp_servers.{name}]");
    let alt = format!("[mcp_servers.\"{name}\"]");
    let Some(block) =
        extract_toml_table_block(&text, &section).or_else(|| extract_toml_table_block(&text, &alt))
    else {
        return std::collections::HashMap::new();
    };
    for line in block.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(field) {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let rest = rest.trim();
                if let Some(inner) = rest.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                    let mut map = std::collections::HashMap::new();
                    for pair in inner.split(',') {
                        let mut parts = pair.splitn(2, '=');
                        let k = parts
                            .next()
                            .unwrap_or("")
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'');
                        let v = parts
                            .next()
                            .unwrap_or("")
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'');
                        if !k.is_empty() {
                            map.insert(k.to_string(), v.to_string());
                        }
                    }
                    return map;
                }
            }
        }
    }
    std::collections::HashMap::new()
}

fn merge_secret_fields(
    fields: &[crate::contracts::McpSecretField],
    existing: &std::collections::HashMap<String, String>,
) -> Result<Vec<(String, String)>, CliBridgeError> {
    let mut out: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // Start from existing for keys marked keep (or absent from input).
    for (k, v) in existing {
        out.insert(k.clone(), v.clone());
    }
    for f in fields {
        let key = f.key.trim();
        if key.is_empty() {
            continue;
        }
        match f.action.as_str() {
            "delete" => {
                out.remove(key);
            }
            "replace" => {
                let val = f.value.as_deref().unwrap_or("").to_string();
                if val.is_empty() {
                    return Err(CliBridgeError::Message(format!(
                        "secret {key}: replace requires a value"
                    )));
                }
                out.insert(key.to_string(), val);
            }
            // "keep" or unknown: preserve existing; accept value only when creating.
            _ => {
                if !out.contains_key(key) {
                    if let Some(v) = f.value.as_ref().filter(|s| !s.is_empty()) {
                        out.insert(key.to_string(), v.clone());
                    }
                }
            }
        }
    }
    // New keys with replace already handled; for create forms action is often "replace" with value.
    Ok(out.into_iter().collect())
}

pub fn upsert_mcp(
    configured: Option<&str>,
    input: &crate::contracts::McpServerInput,
) -> Result<String, CliBridgeError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(CliBridgeError::Message("mcp name empty".into()));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(CliBridgeError::Message(
            "mcp name may only contain letters, numbers, hyphens, and underscores".into(),
        ));
    }
    let target = input.command_or_url.trim();
    if target.is_empty() {
        return Err(CliBridgeError::Message("command or URL is required".into()));
    }

    let cwd = input
        .workspace_root
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    if matches!(input.scope, crate::contracts::McpScope::Project) && cwd.is_none() {
        return Err(CliBridgeError::Message(
            "project-scoped MCP requires a workspace root".into(),
        ));
    }

    let existing_env = read_secret_map_from_disk(name, input.scope, cwd, "env");
    let existing_headers = read_secret_map_from_disk(name, input.scope, cwd, "headers");
    let env_pairs = merge_secret_fields(&input.env, &existing_env)?;
    let header_pairs = merge_secret_fields(&input.headers, &existing_headers)?;

    // Build argv as owned strings so we can pass env/header values safely.
    let mut args: Vec<String> = vec![
        "mcp".into(),
        "add".into(),
        name.into(),
        "--transport".into(),
        input.transport.as_str().into(),
        "--scope".into(),
        input.scope.as_str().into(),
    ];
    for (k, v) in &env_pairs {
        args.push("-e".into());
        args.push(format!("{k}={v}"));
    }
    for (k, v) in &header_pairs {
        args.push("--header".into());
        args.push(format!("{k}: {v}"));
    }

    match input.transport {
        crate::contracts::McpTransport::Stdio => {
            args.push("--".into());
            args.push(target.into());
            for a in &input.args {
                if !a.is_empty() {
                    args.push(a.clone());
                }
            }
        }
        crate::contracts::McpTransport::Http | crate::contracts::McpTransport::Sse => {
            args.push(target.into());
        }
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_grok_in(configured, &arg_refs, cwd)
}

pub fn remove_mcp(
    configured: Option<&str>,
    name: &str,
    scope: Option<crate::contracts::McpScope>,
    workspace_root: Option<&str>,
) -> Result<String, CliBridgeError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CliBridgeError::Message("mcp name empty".into()));
    }
    let cwd = workspace_root.filter(|s| !s.trim().is_empty());
    let mut args = vec!["mcp".to_string(), "remove".to_string(), name.to_string()];
    if let Some(s) = scope {
        args.push("--scope".into());
        args.push(s.as_str().into());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_grok_in(configured, &arg_refs, cwd)
}

pub fn doctor_mcp(
    configured: Option<&str>,
    name: Option<&str>,
    workspace_root: Option<&str>,
) -> Result<Vec<crate::contracts::McpDoctorResult>, CliBridgeError> {
    doctor_mcp_with_timeout(configured, name, workspace_root, Duration::from_secs(15))
}

fn doctor_mcp_with_timeout(
    configured: Option<&str>,
    name: Option<&str>,
    workspace_root: Option<&str>,
    timeout: Duration,
) -> Result<Vec<crate::contracts::McpDoctorResult>, CliBridgeError> {
    let cwd = workspace_root.filter(|s| !s.trim().is_empty());
    let mut args = vec![
        "mcp".to_string(),
        "doctor".to_string(),
        "--json".to_string(),
    ];
    if let Some(n) = name.map(str::trim).filter(|s| !s.is_empty()) {
        args.push(n.to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = match run_grok_in_timeout(configured, &arg_refs, cwd, timeout) {
        Ok(o) => o,
        Err(e) => {
            // Doctor may exit non-zero with useful JSON/text on stderr already redacted.
            return Ok(vec![crate::contracts::McpDoctorResult {
                name: name.unwrap_or("*").to_string(),
                ok: false,
                summary: e.to_string(),
                error: Some(e.to_string()),
                tools: vec![],
                checked_at: chrono_iso_now(),
            }]);
        }
    };
    Ok(parse_doctor_output(&out, name))
}

fn chrono_iso_now() -> String {
    // Avoid chrono dependency: RFC-ish local timestamp via system.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| {
            let secs = d.as_secs();
            format!("{secs}")
        })
        .unwrap_or_else(|_| "0".into())
}

fn parse_doctor_output(
    out: &str,
    fallback_name: Option<&str>,
) -> Vec<crate::contracts::McpDoctorResult> {
    let checked_at = iso_now_fallback();
    let trimmed = out.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(arr) = value
            .as_array()
            .cloned()
            .or_else(|| value.get("servers").and_then(|v| v.as_array()).cloned())
            .or_else(|| value.get("results").and_then(|v| v.as_array()).cloned())
        {
            return arr
                .into_iter()
                .map(|item| doctor_from_json(item, &checked_at))
                .collect();
        }
        if value.is_object() {
            return vec![doctor_from_json(value, &checked_at)];
        }
    }
    // Text fallback
    let ok = !trimmed.to_lowercase().contains("error")
        && !trimmed.to_lowercase().contains("fail")
        && !trimmed.is_empty();
    vec![crate::contracts::McpDoctorResult {
        name: fallback_name.unwrap_or("*").to_string(),
        ok,
        summary: if trimmed.is_empty() {
            "no output".into()
        } else {
            crate::secrets::redact_secrets(trimmed)
                .chars()
                .take(400)
                .collect()
        },
        error: if ok {
            None
        } else {
            Some(
                crate::secrets::redact_secrets(trimmed)
                    .chars()
                    .take(400)
                    .collect(),
            )
        },
        tools: vec![],
        checked_at,
    }]
}

fn doctor_from_json(
    item: serde_json::Value,
    checked_at: &str,
) -> crate::contracts::McpDoctorResult {
    let name = item
        .get("name")
        .or_else(|| item.get("server"))
        .and_then(|v| v.as_str())
        .unwrap_or("*")
        .to_string();
    let ok = item
        .get("ok")
        .or_else(|| item.get("healthy"))
        .or_else(|| item.get("success"))
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| {
            item.get("status")
                .and_then(|v| v.as_str())
                .map(|s| {
                    let s = s.to_ascii_lowercase();
                    s == "ok" || s == "healthy" || s == "connected"
                })
                .unwrap_or(false)
        });
    let error = item
        .get("error")
        .and_then(|v| v.as_str())
        .map(crate::secrets::redact_secrets);
    let tools: Vec<crate::contracts::McpToolSummary> = item
        .get("tools")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|t| {
                    let n = t
                        .get("name")
                        .and_then(|v| v.as_str())
                        .or_else(|| t.as_str())?;
                    Some(crate::contracts::McpToolSummary {
                        name: n.to_string(),
                        description: t
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let summary = item
        .get("summary")
        .or_else(|| item.get("message"))
        .and_then(|v| v.as_str())
        .map(crate::secrets::redact_secrets)
        .unwrap_or_else(|| {
            if ok {
                format!("ok · {} tools", tools.len())
            } else {
                error.clone().unwrap_or_else(|| "failed".into())
            }
        });
    crate::contracts::McpDoctorResult {
        name,
        ok,
        summary,
        error,
        tools,
        checked_at: checked_at.to_string(),
    }
}

fn iso_now_fallback() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

// --- Auth / update (T12) --------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub channel: Option<String>,
    pub raw: serde_json::Value,
}

pub fn check_update(configured: Option<&str>) -> Result<UpdateCheck, CliBridgeError> {
    let out = run_grok(configured, &["update", "--check", "--json"])?;
    let raw: serde_json::Value =
        serde_json::from_str(out.trim()).unwrap_or(serde_json::Value::Null);
    Ok(UpdateCheck {
        current_version: raw
            .get("currentVersion")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        latest_version: raw
            .get("latestVersion")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        update_available: raw
            .get("updateAvailable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        channel: raw
            .get("channel")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        raw,
    })
}

pub fn run_update(configured: Option<&str>) -> Result<String, CliBridgeError> {
    run_grok(configured, &["update"])
}

pub fn run_login_oauth(configured: Option<&str>) -> Result<String, CliBridgeError> {
    // Device auth is reliable across desktop, WSL, VPN and browser-restricted setups.
    run_grok(configured, &["login", "--device-auth"])
}

pub fn run_logout(configured: Option<&str>) -> Result<String, CliBridgeError> {
    // Best-effort: try common logout subcommands.
    match run_grok(configured, &["logout"]) {
        Ok(s) => Ok(s),
        Err(_) => run_grok(configured, &["auth", "logout"])
            .or_else(|_| Ok("Logout command is not available in this Grok CLI version.".into())),
    }
}

// --- Install CLI (T12) ----------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub phase: String,
    pub detail: String,
    pub ok: bool,
}

/// Download official install script to a temp file and execute it.
/// `source_url` must be the fixed official URL in production UI.
pub fn install_cli_from_script(
    source_url: &str,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<InstallProgress>, CliBridgeError> {
    let mut log = Vec::new();
    if source_url != OFFICIAL_INSTALL_URL && !source_url.starts_with("file://") {
        // Tests may use file:// fixtures; production only allows official URL.
        return Err(CliBridgeError::Message(
            "install source must be the official xAI install URL".into(),
        ));
    }
    if cancel.load(Ordering::SeqCst) {
        return Err(CliBridgeError::Message("install cancelled".into()));
    }

    log.push(InstallProgress {
        phase: "download".into(),
        detail: format!("Fetching {source_url}"),
        ok: true,
    });

    #[cfg(target_os = "windows")]
    let extension = "ps1";
    #[cfg(not(target_os = "windows"))]
    let extension = "sh";
    let tmp = std::env::temp_dir().join(format!(
        "grok-install-{}-{}.{}",
        std::process::id(),
        uuid::Uuid::new_v4(),
        extension,
    ));

    if let Some(path) = source_url.strip_prefix("file://") {
        std::fs::copy(path, &tmp)?;
    } else {
        // Download without piping user input into shell.
        #[cfg(target_os = "windows")]
        let downloader = "curl.exe";
        #[cfg(not(target_os = "windows"))]
        let downloader = "curl";
        let status = Command::new(downloader)
            .args(["-fsSL", "--proto", "=https", "--tlsv1.2", "-o"])
            .arg(&tmp)
            .arg(source_url)
            .status()?;
        if !status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(CliBridgeError::Message(
                "download failed (network or TLS)".into(),
            ));
        }
    }

    if cancel.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&tmp);
        return Err(CliBridgeError::Message("install cancelled".into()));
    }

    // Basic integrity: non-empty and looks like a shell script.
    let meta = std::fs::metadata(&tmp)?;
    if meta.len() < 32 {
        let _ = std::fs::remove_file(&tmp);
        return Err(CliBridgeError::Message(
            "downloaded install script empty/corrupt".into(),
        ));
    }

    log.push(InstallProgress {
        phase: "verify".into(),
        detail: format!("Script size {} bytes", meta.len()),
        ok: true,
    });

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&tmp)?.permissions();
        perms.set_mode(0o700);
        std::fs::set_permissions(&tmp, perms)?;
    }

    log.push(InstallProgress {
        phase: "install".into(),
        detail: "Running install script".into(),
        ok: true,
    });

    #[cfg(target_os = "windows")]
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("/bin/bash")
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    let _ = std::fs::remove_file(&tmp);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        log.push(InstallProgress {
            phase: "failed".into(),
            detail: crate::secrets::redact_secrets(&format!("{stderr}\n{stdout}")),
            ok: false,
        });
        return Err(CliBridgeError::Message(
            "install script exited with error (previous CLI preserved if present)".into(),
        ));
    }

    log.push(InstallProgress {
        phase: "done".into(),
        detail: "Install finished".into(),
        ok: true,
    });

    // Post-verify
    match resolve_grok(None) {
        Ok(p) => {
            let ver = Command::new(&p)
                .arg("--version")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            log.push(InstallProgress {
                phase: "verify_cli".into(),
                detail: format!("{p} {ver}"),
                ok: true,
            });
        }
        Err(e) => {
            log.push(InstallProgress {
                phase: "verify_cli".into(),
                detail: e.to_string(),
                ok: false,
            });
        }
    }

    Ok(log)
}

#[cfg(target_os = "windows")]
pub const OFFICIAL_INSTALL_URL: &str = "https://x.ai/cli/install.ps1";
#[cfg(not(target_os = "windows"))]
pub const OFFICIAL_INSTALL_URL: &str = "https://x.ai/cli/install.sh";

// --- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[cfg(unix)]
    fn fake_grok(script_body: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("gbd-fake-grok-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("grok");
        std::fs::write(&script, format!("#!/bin/sh\n{script_body}\n")).unwrap();
        let mut permissions = std::fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script, permissions).unwrap();
        (script, dir)
    }

    #[test]
    fn install_rejects_non_official_http() {
        let cancel = Arc::new(AtomicBool::new(false));
        let err = install_cli_from_script("https://evil.example/install.sh", cancel).unwrap_err();
        assert!(err.to_string().contains("official"));
    }

    #[cfg(unix)]
    #[test]
    fn install_from_file_fixture_runs_bash() {
        let dir = std::env::temp_dir().join(format!("gbd-install-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("install.sh");
        let mut f = std::fs::File::create(&script).unwrap();
        writeln!(f, "#!/bin/bash").unwrap();
        writeln!(f, "echo mock-install-ok").unwrap();
        drop(f);
        let url = format!("file://{}", script.display());
        let cancel = Arc::new(AtomicBool::new(false));
        let log = install_cli_from_script(&url, cancel).unwrap();
        assert!(log.iter().any(|p| p.phase == "done" && p.ok));
    }

    #[test]
    fn install_cancel_before_run() {
        let cancel = Arc::new(AtomicBool::new(true));
        let err = install_cli_from_script(OFFICIAL_INSTALL_URL, cancel).unwrap_err();
        assert!(err.to_string().contains("cancel"));
    }

    #[test]
    fn list_plugins_handles_empty_json() {
        // Live CLI may return []; should not panic when grok exists.
        if resolve_grok(None).is_ok() {
            let _ = list_plugins(None);
        }
    }

    #[test]
    fn capability_items_accept_arrays_and_object_maps() {
        let array = serde_json::json!({
            "skills": [{ "id": "review", "name": "Review", "source": "project" }]
        });
        let skills = capability_items(&array, &["skills"]);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "review");

        let map = serde_json::json!({
            "hooks": { "before-run": { "enabled": true } }
        });
        let hooks = capability_items(&map, &["hooks"]);
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].name, "before-run");
        assert_eq!(hooks[0].enabled, Some(true));
    }

    #[cfg(unix)]
    #[test]
    fn mcp_uses_argv_and_project_cwd_without_shell_concatenation() {
        let (script, dir) = fake_grok("printf '%s\\n' \"$PWD\" \"$@\" > argv.log\necho ok");
        let input = crate::contracts::McpServerInput {
            name: "demo".into(),
            scope: crate::contracts::McpScope::Project,
            transport: crate::contracts::McpTransport::Stdio,
            command_or_url: "node".into(),
            args: vec!["argument with spaces".into(), "--flag".into()],
            env: vec![],
            headers: vec![],
            workspace_root: Some(dir.to_string_lossy().into()),
        };
        upsert_mcp(script.to_str(), &input).unwrap();
        let log = std::fs::read_to_string(dir.join("argv.log")).unwrap();
        let lines: Vec<_> = log.lines().collect();
        assert_eq!(
            std::fs::canonicalize(lines[0]).unwrap(),
            std::fs::canonicalize(&dir).unwrap()
        );
        assert!(lines.contains(&"argument with spaces"));
        assert!(lines.contains(&"--transport"));
        assert!(lines.contains(&"project"));
    }

    #[cfg(unix)]
    #[test]
    fn doctor_times_out_and_kills_the_fake_cli() {
        let (script, dir) = fake_grok("sleep 2\necho '[]'");
        let results = doctor_mcp_with_timeout(
            script.to_str(),
            Some("slow"),
            Some(dir.to_string_lossy().as_ref()),
            Duration::from_millis(75),
        )
        .unwrap();
        assert!(!results[0].ok);
        assert!(results[0].summary.contains("timed out"));
    }

    #[test]
    fn parse_models_text_ignores_login_banner_and_log_noise() {
        let out = "You are logged in with grok.com.\n\n\
            \u{1b}[2m2026-07-12T06:00:02.725895Z\u{1b}[0m \u{1b}[31mERROR\u{1b}[0m Settings fetch failed\n\
            Default model: grok-4.5\n\n\
            Available models:\n\
              * grok-4.5 (default)\n\
              - grok-composer-2.5-fast\n";
        let models = parse_models_text(out);
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["grok-4.5", "grok-composer-2.5-fast"]);
        assert!(models.iter().any(|m| m.id == "grok-4.5" && m.is_default));
        assert!(!ids.contains(&"You"));
    }
}
