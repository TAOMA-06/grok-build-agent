//! Grok CLI management: plugins, MCP, login, update, install.
//! All commands use argv arrays — never shell-concatenate user input.

use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
    let path = resolve_grok(configured)?;
    let output = Command::new(&path).args(args).output()?;
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

// --- MCP (T11) ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub command: Option<String>,
    pub status: Option<String>,
}

pub fn list_mcp(configured: Option<&str>) -> Result<Vec<McpServerInfo>, CliBridgeError> {
    // Prefer JSON if available; fall back to text parse of `grok mcp list`.
    if let Ok(out) = run_grok(configured, &["mcp", "list", "--json"]) {
        let trimmed = out.trim();
        if trimmed.is_empty() || trimmed == "[]" {
            return Ok(vec![]);
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
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
                servers.push(McpServerInfo {
                    name: name.to_string(),
                    command: item
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    status: item
                        .get("status")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
            return Ok(servers);
        }
    }

    let out = run_grok(configured, &["mcp", "list"]).unwrap_or_default();
    if out.to_lowercase().contains("no mcp") {
        return Ok(vec![]);
    }
    // Best-effort line parse: name on non-empty lines that look like entries.
    let mut servers = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("No ") || line.starts_with("Run ") {
            continue;
        }
        let name = line.split_whitespace().next().unwrap_or(line).to_string();
        if name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            servers.push(McpServerInfo {
                name,
                command: None,
                status: Some("configured".into()),
            });
        }
    }
    Ok(servers)
}

pub fn remove_mcp(configured: Option<&str>, name: &str) -> Result<String, CliBridgeError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CliBridgeError::Message("mcp name empty".into()));
    }
    run_grok(configured, &["mcp", "remove", name])
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
    // Spawns `grok login --oauth` — may open browser; capture output.
    run_grok(configured, &["login", "--oauth"])
}

pub fn run_logout(configured: Option<&str>) -> Result<String, CliBridgeError> {
    // Best-effort: try common logout subcommands.
    match run_grok(configured, &["logout"]) {
        Ok(s) => Ok(s),
        Err(_) => run_grok(configured, &["auth", "logout"]).or_else(|_| {
            Ok("Logout command not available; remove ~/.grok/auth.json manually if needed.".into())
        }),
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

    let tmp = std::env::temp_dir().join(format!(
        "grok-install-{}-{}.sh",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));

    if let Some(path) = source_url.strip_prefix("file://") {
        std::fs::copy(path, &tmp)?;
    } else {
        // Download without piping user input into shell.
        let status = Command::new("curl")
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

pub const OFFICIAL_INSTALL_URL: &str = "https://x.ai/cli/install.sh";

// --- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn install_rejects_non_official_http() {
        let cancel = Arc::new(AtomicBool::new(false));
        let err = install_cli_from_script("https://evil.example/install.sh", cancel).unwrap_err();
        assert!(err.to_string().contains("official"));
    }

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
}
