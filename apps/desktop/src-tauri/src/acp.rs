//! ACP (Agent Client Protocol) host: spawns `grok agent stdio` and bridges JSON-RPC.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Error)]
pub enum AcpError {
    #[error("{0}")]
    Message(String),
    #[error("agent is not running")]
    NotRunning,
    #[error("agent request timed out")]
    Timeout,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Serialize for AcpError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConfig {
    /// Path to the `grok` binary. Empty = search PATH.
    pub grok_path: Option<String>,
    pub model: Option<String>,
    pub always_approve: bool,
    pub cwd: String,
    /// Optional extra system rules (harness overlay).
    pub rules: Option<String>,
    pub agent_profile: Option<String>,
    /// When true, inject built-in orchestrator harness rules.
    pub use_harness: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub running: bool,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub grok_path: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokProbe {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

struct Pending {
    tx: oneshot::Sender<Result<Value, AcpError>>,
}

struct RuntimeInner {
    child: Mutex<Child>,
    write_tx: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    next_id: AtomicU64,
    session_id: Mutex<Option<String>>,
    cwd: Mutex<Option<String>>,
    grok_path: String,
}

#[derive(Clone, Default)]
pub struct AcpRuntime {
    inner: Arc<Mutex<Option<Arc<RuntimeInner>>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl AcpRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> AgentStatus {
        let guard = self.inner.lock();
        match guard.as_ref() {
            Some(rt) => AgentStatus {
                running: true,
                session_id: rt.session_id.lock().clone(),
                cwd: rt.cwd.lock().clone(),
                grok_path: Some(rt.grok_path.clone()),
                last_error: self.last_error.lock().clone(),
            },
            None => AgentStatus {
                running: false,
                session_id: None,
                cwd: None,
                grok_path: None,
                last_error: self.last_error.lock().clone(),
            },
        }
    }

    pub async fn start(&self, app: AppHandle, config: StartConfig) -> Result<AgentStatus, AcpError> {
        self.stop().await?;

        let grok_path = resolve_grok_path(config.grok_path.as_deref())?;
        let mut cmd = Command::new(&grok_path);
        cmd.arg("agent");
        if let Some(model) = &config.model {
            if !model.is_empty() {
                cmd.arg("--model").arg(model);
            }
        }
        if config.always_approve {
            cmd.arg("--always-approve");
        }
        cmd.arg("stdio");
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Ok(path) = std::env::var("PATH") {
            let home = std::env::var("HOME").unwrap_or_default();
            let extra = format!("{home}/.grok/bin:{home}/.local/bin:/usr/local/bin:/opt/homebrew/bin:{path}");
            cmd.env("PATH", extra);
        }
        // Inherit API key if present (from app settings or shell).
        if let Ok(key) = std::env::var("XAI_API_KEY") {
            if !key.is_empty() {
                cmd.env("XAI_API_KEY", key);
            }
        }

        let mut child = cmd.spawn().map_err(|e| {
            AcpError::Message(format!("failed to spawn grok at {grok_path}: {e}"))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::Message("missing stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::Message("missing stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AcpError::Message("missing stderr".into()))?;

        let pending: Arc<Mutex<HashMap<u64, Pending>>> = Arc::new(Mutex::new(HashMap::new()));
        let (write_tx, write_rx) = mpsc::unbounded_channel::<String>();

        tokio::spawn(writer_loop(stdin, write_rx));

        {
            let app = app.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = app.emit("acp:stderr", line);
                }
            });
        }

        {
            let app = app.clone();
            let pending = pending.clone();
            let runtime_slot = self.inner.clone();
            tokio::spawn(async move {
                reader_loop(app, stdout, pending, runtime_slot).await;
            });
        }

        let rt = Arc::new(RuntimeInner {
            child: Mutex::new(child),
            write_tx,
            pending,
            next_id: AtomicU64::new(1),
            session_id: Mutex::new(None),
            cwd: Mutex::new(Some(config.cwd.clone())),
            grok_path: grok_path.clone(),
        });

        *self.inner.lock() = Some(rt.clone());
        *self.last_error.lock() = None;

        let init_result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": true, "writeTextFile": true },
                        "terminal": true
                    },
                    "clientInfo": {
                        "name": "grok-build-desktop",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await;

        if let Err(e) = init_result {
            let msg = e.to_string();
            *self.last_error.lock() = Some(msg.clone());
            let _ = self.stop().await;
            return Err(AcpError::Message(format!("initialize failed: {msg}")));
        }

        let mut params = json!({
            "cwd": config.cwd,
            "mcpServers": []
        });

        let mut rules = config.rules.unwrap_or_default();
        if config.use_harness {
            let harness = default_harness_rules();
            if rules.is_empty() {
                rules = harness;
            } else {
                rules = format!("{harness}\n\n{rules}");
            }
        }

        let mut meta = json!({});
        if !rules.trim().is_empty() {
            meta["rules"] = Value::String(rules);
        }
        if let Some(profile) = config.agent_profile {
            if !profile.trim().is_empty() {
                meta["agentProfile"] = Value::String(profile);
            }
        }
        if meta.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
            params["_meta"] = meta;
        }

        let session = self.request("session/new", params).await.map_err(|e| {
            let msg = e.to_string();
            *self.last_error.lock() = Some(msg.clone());
            AcpError::Message(format!("session/new failed: {msg}"))
        })?;

        let session_id = session
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| AcpError::Message(format!("session/new missing sessionId: {session}")))?;

        *rt.session_id.lock() = Some(session_id);
        let _ = app.emit("acp:status", self.status());

        Ok(self.status())
    }

    pub async fn stop(&self) -> Result<(), AcpError> {
        let rt = self.inner.lock().take();
        if let Some(rt) = rt {
            {
                let mut pending = rt.pending.lock();
                for (_, p) in pending.drain() {
                    let _ = p.tx.send(Err(AcpError::NotRunning));
                }
            }
            let mut child = rt.child.lock();
            let _ = child.start_kill();
        }
        Ok(())
    }

    pub async fn prompt(&self, text: &str) -> Result<Value, AcpError> {
        let session_id = {
            let guard = self.inner.lock();
            let rt = guard.as_ref().ok_or(AcpError::NotRunning)?;
            let id = rt.session_id.lock().clone();
            id.ok_or_else(|| AcpError::Message("no session".into()))?
        };

        self.request(
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": text }]
            }),
        )
        .await
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        let (id, write_tx, pending) = {
            let guard = self.inner.lock();
            let rt = guard.as_ref().ok_or(AcpError::NotRunning)?;
            let id = rt.next_id.fetch_add(1, Ordering::SeqCst);
            (id, rt.write_tx.clone(), rt.pending.clone())
        };

        let (tx, rx) = oneshot::channel();
        pending.lock().insert(id, Pending { tx });

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let line = serde_json::to_string(&msg)?;
        write_tx
            .send(line)
            .map_err(|_| AcpError::Message("write channel closed".into()))?;

        match tokio::time::timeout(std::time::Duration::from_secs(600), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(AcpError::Message("response channel closed".into())),
            Err(_) => {
                pending.lock().remove(&id);
                Err(AcpError::Timeout)
            }
        }
    }

    pub async fn respond_to_request(
        &self,
        id: Value,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<(), AcpError> {
        let write_tx = {
            let guard = self.inner.lock();
            let rt = guard.as_ref().ok_or(AcpError::NotRunning)?;
            rt.write_tx.clone()
        };

        let mut msg = json!({
            "jsonrpc": "2.0",
            "id": id
        });
        if let Some(err) = error {
            msg["error"] = err;
        } else {
            msg["result"] = result.unwrap_or(json!({}));
        }
        let line = serde_json::to_string(&msg)?;
        write_tx
            .send(line)
            .map_err(|_| AcpError::Message("write channel closed".into()))?;
        Ok(())
    }
}

async fn writer_loop(mut stdin: ChildStdin, mut rx: mpsc::UnboundedReceiver<String>) {
    while let Some(line) = rx.recv().await {
        if stdin.write_all(line.as_bytes()).await.is_err() {
            break;
        }
        if stdin.write_all(b"\n").await.is_err() {
            break;
        }
        if stdin.flush().await.is_err() {
            break;
        }
    }
}

async fn reader_loop(
    app: AppHandle,
    stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    runtime_slot: Arc<Mutex<Option<Arc<RuntimeInner>>>>,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = app.emit(
                    "acp:error",
                    format!("invalid JSON from agent: {e}; line={line}"),
                );
                continue;
            }
        };

        // Response to our request
        if let Some(id_val) = parsed.get("id") {
            if parsed.get("method").is_none() {
                let id = match id_val.as_u64() {
                    Some(i) => i,
                    None => id_val.as_i64().map(|i| i as u64).unwrap_or(0),
                };
                if let Some(p) = pending.lock().remove(&id) {
                    if let Some(err) = parsed.get("error") {
                        let msg = err
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("agent error")
                            .to_string();
                        let _ = p.tx.send(Err(AcpError::Message(msg)));
                    } else {
                        let result = parsed.get("result").cloned().unwrap_or(Value::Null);
                        let _ = p.tx.send(Ok(result));
                    }
                }
                continue;
            }

            // Server-initiated request (permission, etc.)
            let _ = app.emit("acp:server_request", &parsed);
            continue;
        }

        // Notification
        if let Some(method) = parsed.get("method").and_then(|m| m.as_str()) {
            let params = parsed.get("params").cloned().unwrap_or(Value::Null);

            if method == "session/update" {
                let _ = app.emit("acp:session_update", params);
            } else if method.starts_with("x.ai/") {
                let _ = app.emit(
                    "acp:extension",
                    json!({ "method": method, "params": params }),
                );
            } else {
                let _ = app.emit(
                    "acp:notification",
                    json!({ "method": method, "params": params }),
                );
            }
        }
    }

    *runtime_slot.lock() = None;
    let _ = app.emit(
        "acp:status",
        AgentStatus {
            running: false,
            session_id: None,
            cwd: None,
            grok_path: None,
            last_error: Some("agent process exited".into()),
        },
    );
}

fn resolve_grok_path(configured: Option<&str>) -> Result<String, AcpError> {
    if let Some(p) = configured {
        if !p.trim().is_empty() {
            let path = shellexpand_home(p.trim());
            if std::path::Path::new(&path).exists() {
                return Ok(path);
            }
            return Err(AcpError::Message(format!("grok binary not found: {path}")));
        }
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.grok/bin/grok"),
        format!("{home}/.local/bin/grok"),
        "/usr/local/bin/grok".to_string(),
        "/opt/homebrew/bin/grok".to_string(),
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Ok(c.clone());
        }
    }

    if let Ok(output) = std::process::Command::new("/usr/bin/which")
        .arg("grok")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Ok(path);
            }
        }
    }

    Err(AcpError::Message(
        "grok CLI not found. Install Grok Build and ensure `grok` is on PATH, or set the path in Settings."
            .into(),
    ))
}

fn shellexpand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return home;
        }
    }
    path.to_string()
}

pub fn probe_grok(configured: Option<&str>) -> GrokProbe {
    match resolve_grok_path(configured) {
        Ok(path) => {
            let version = std::process::Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|o| {
                    let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if !out.is_empty() {
                        Some(out)
                    } else {
                        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if err.is_empty() {
                            None
                        } else {
                            Some(err)
                        }
                    }
                });
            GrokProbe {
                found: true,
                path: Some(path),
                version,
                error: None,
            }
        }
        Err(e) => GrokProbe {
            found: false,
            path: None,
            version: None,
            error: Some(e.to_string()),
        },
    }
}

pub fn default_harness_rules() -> String {
    include_str!("../../../../harness/AGENTS.md").to_string()
}
