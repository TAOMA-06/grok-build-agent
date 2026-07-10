//! One ACP child process connection (multi-session capable).

use super::{AcpError, AgentStatus, StartConfig};
use crate::contracts::{
    ConnectionKey, ConnectionSnapshot, ConnectionState, EventSource, PowerProfile,
    RuntimeSnapshot, SandboxMode, SessionEventEnvelope,
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use super::events::{emit_json, SharedEventBus};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

pub struct Pending {
    pub tx: oneshot::Sender<Result<Value, AcpError>>,
}

pub struct ConnectionInner {
    pub connection_id: String,
    pub key: ConnectionKey,
    pub child: Mutex<Child>,
    pub pid: u32,
    pub write_tx: mpsc::UnboundedSender<String>,
    pub pending: Arc<Mutex<HashMap<u64, Pending>>>,
    pub next_id: AtomicU64,
    pub sequence: AtomicU64,
    pub session_ids: Mutex<HashSet<String>>,
    pub active_session_id: Mutex<Option<String>>,
    pub cwd: PathBuf,
    pub grok_path: String,
    pub state: Mutex<ConnectionState>,
    pub last_error: Mutex<Option<String>>,
    pub started_at: String,
    pub last_event_at: Mutex<Option<String>>,
    /// When true, reader_loop should not clear the pool slot (explicit stop).
    pub stopping: Mutex<bool>,
}

impl ConnectionInner {
    pub fn snapshot(&self) -> ConnectionSnapshot {
        ConnectionSnapshot {
            connection_id: self.connection_id.clone(),
            key: self.key.clone(),
            state: self.state.lock().clone(),
            grok_path: Some(self.grok_path.clone()),
            pid: Some(self.pid),
            session_ids: self.session_ids.lock().iter().cloned().collect(),
            capabilities: None,
            last_error: self.last_error.lock().clone(),
            started_at: Some(self.started_at.clone()),
            last_event_at: self.last_event_at.lock().clone(),
        }
    }

    pub fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst)
    }

    pub fn mark_event(&self) {
        *self.last_event_at.lock() = Some(chrono_now());
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AcpError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, Pending { tx });

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let line = serde_json::to_string(&msg)?;
        if self.write_tx.send(line).is_err() {
            self.pending.lock().remove(&id);
            return Err(AcpError::Message("write channel closed".into()));
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(AcpError::Message("response channel closed".into())),
            Err(_) => {
                self.pending.lock().remove(&id);
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
        self.write_tx
            .send(line)
            .map_err(|_| AcpError::Message("write channel closed".into()))?;
        Ok(())
    }

    pub fn fail_all_pending(&self, err: AcpError) {
        let mut pending = self.pending.lock();
        for (_, p) in pending.drain() {
            let _ = p.tx.send(Err(match &err {
                AcpError::Message(m) => AcpError::Message(m.clone()),
                AcpError::NotRunning => AcpError::NotRunning,
                AcpError::Timeout => AcpError::Timeout,
                AcpError::Cancelled => AcpError::Cancelled,
                AcpError::Io(e) => AcpError::Message(e.to_string()),
                AcpError::Json(e) => AcpError::Message(e.to_string()),
            }));
        }
    }

    pub async fn kill_child(&self) {
        *self.stopping.lock() = true;
        self.fail_all_pending(AcpError::NotRunning);
        {
            let mut child = self.child.lock();
            let _ = child.start_kill();
        }
        // Belt-and-suspenders: ensure the process group is gone on Unix.
        if self.pid > 0 {
            let _ = std::process::Command::new("kill")
                .args(["-9", &self.pid.to_string()])
                .status();
        }
        // Poll without holding the mutex across await (Send requirement).
        for _ in 0..30 {
            {
                let mut child = self.child.lock();
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => {}
                    Err(_) => return,
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

pub fn chrono_now() -> String {
    // Avoid chrono dep: RFC3339-ish via SystemTime.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Sufficient for ordering / display; tests use deterministic values where needed.
    format!("{secs}")
}

pub fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    // UTC approx without chrono — good enough for wire timestamps.
    let days = secs / 86400;
    let day_secs = secs % 86400;
    let hours = day_secs / 3600;
    let mins = (day_secs % 3600) / 60;
    let s = day_secs % 60;
    // Civil date from days since epoch (proleptic Gregorian).
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{hours:02}:{mins:02}:{s:02}.{millis:03}Z")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    // Howard Hinnant algorithm
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

pub fn normalize_workspace(cwd: &str) -> Result<PathBuf, AcpError> {
    let expanded = shellexpand_home(cwd.trim());
    if expanded.is_empty() {
        return Err(AcpError::Message("workspace cwd is empty".into()));
    }
    let path = PathBuf::from(&expanded);
    if !path.exists() {
        return Err(AcpError::Message(format!(
            "workspace does not exist: {}",
            path.display()
        )));
    }
    let canon = std::fs::canonicalize(&path).map_err(|e| {
        AcpError::Message(format!("canonicalize {}: {e}", path.display()))
    })?;
    Ok(canon)
}

pub fn connection_key_from_config(config: &StartConfig, workspace: PathBuf) -> ConnectionKey {
    ConnectionKey {
        workspace_root: workspace.to_string_lossy().into(),
        sandbox: config.sandbox.unwrap_or(SandboxMode::None),
        power_profile: config.power_profile,
    }
}

pub fn shellexpand_home(path: &str) -> String {
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

pub fn resolve_grok_path(configured: Option<&str>) -> Result<String, AcpError> {
    if let Some(p) = configured {
        if !p.trim().is_empty() {
            let path = shellexpand_home(p.trim());
            if Path::new(&path).exists() {
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
        if Path::new(c).exists() {
            return Ok(c.clone());
        }
    }

    if let Ok(output) = std::process::Command::new("/usr/bin/which")
        .arg("grok")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && Path::new(&path).exists() {
                return Ok(path);
            }
        }
    }

    Err(AcpError::Message(
        "grok CLI not found. Install Grok Build and ensure `grok` is on PATH, or set the path in Settings."
            .into(),
    ))
}

pub async fn spawn_connection(
    bus: SharedEventBus,
    config: StartConfig,
    pool_slot: Arc<Mutex<HashMap<String, Arc<ConnectionInner>>>>,
    key_index: Arc<Mutex<HashMap<String, String>>>,
) -> Result<Arc<ConnectionInner>, AcpError> {
    let workspace = normalize_workspace(&config.cwd)?;
    let key = connection_key_from_config(&config, workspace.clone());
    let key_str = key.key_string();
    let grok_path = resolve_grok_path(config.grok_path.as_deref())?;

    // Real grok: `grok agent … stdio`. Python mock fixtures are launched via interpreter.
    let mut cmd = if grok_path.ends_with(".py") {
        let mut c = Command::new("python3");
        c.arg(&grok_path);
        c
    } else {
        Command::new(&grok_path)
    };
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
    cmd.current_dir(&workspace);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Ok(path) = std::env::var("PATH") {
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = format!(
            "{home}/.grok/bin:{home}/.local/bin:/usr/local/bin:/opt/homebrew/bin:{path}"
        );
        cmd.env("PATH", extra);
    }
    if let Ok(key) = std::env::var("XAI_API_KEY") {
        if !key.is_empty() {
            cmd.env("XAI_API_KEY", key);
        }
    }

    // Sandbox / power profile: pass via env until CLI exposes first-class flags.
    let sandbox = match key.sandbox {
        SandboxMode::None => "none",
        SandboxMode::Workspace => "workspace",
        SandboxMode::Strict => "strict",
    };
    cmd.env("GROK_BUILD_SANDBOX", sandbox);
    if let Some(profile) = key.power_profile {
        let p = match profile {
            PowerProfile::Balanced => "balanced",
            PowerProfile::Performance => "performance",
            PowerProfile::Efficiency => "efficiency",
        };
        cmd.env("GROK_BUILD_POWER_PROFILE", p);
    }
    cmd.env("GROK_BUILD_WORKSPACE", workspace.to_string_lossy().as_ref());

    let mut child = cmd.spawn().map_err(|e| {
        AcpError::Message(format!("failed to spawn grok at {grok_path}: {e}"))
    })?;

    let pid = child.id().unwrap_or(0);
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

    let connection_id = uuid::Uuid::new_v4().to_string();
    let pending: Arc<Mutex<HashMap<u64, Pending>>> = Arc::new(Mutex::new(HashMap::new()));
    let (write_tx, write_rx) = mpsc::unbounded_channel::<String>();

    tokio::spawn(writer_loop(stdin, write_rx));

    {
        let bus = bus.clone();
        let connection_id = connection_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_json(
                    &bus,
                    "acp:stderr",
                    json!({
                        "connectionId": connection_id,
                        "line": line,
                    }),
                );
            }
        });
    }

    let inner = Arc::new(ConnectionInner {
        connection_id: connection_id.clone(),
        key: key.clone(),
        child: Mutex::new(child),
        pid,
        write_tx,
        pending: pending.clone(),
        next_id: AtomicU64::new(1),
        sequence: AtomicU64::new(1),
        session_ids: Mutex::new(HashSet::new()),
        active_session_id: Mutex::new(None),
        cwd: workspace,
        grok_path: grok_path.clone(),
        state: Mutex::new(ConnectionState::Starting),
        last_error: Mutex::new(None),
        started_at: iso_now(),
        last_event_at: Mutex::new(None),
        stopping: Mutex::new(false),
    });

    {
        let bus = bus.clone();
        let conn = inner.clone();
        let pool_slot = pool_slot.clone();
        let key_index = key_index.clone();
        let key_str = key_str.clone();
        tokio::spawn(async move {
            reader_loop(bus, stdout, conn, pool_slot, key_index, key_str).await;
        });
    }

    pool_slot
        .lock()
        .insert(connection_id.clone(), inner.clone());
    key_index.lock().insert(key_str, connection_id.clone());

    *inner.state.lock() = ConnectionState::Initializing;

    Ok(inner)
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
    bus: SharedEventBus,
    stdout: tokio::process::ChildStdout,
    conn: Arc<ConnectionInner>,
    pool_slot: Arc<Mutex<HashMap<String, Arc<ConnectionInner>>>>,
    key_index: Arc<Mutex<HashMap<String, String>>>,
    key_str: String,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                emit_error(
                    &bus,
                    &conn,
                    format!("invalid JSON from agent: {e}; line={line}"),
                );
                continue;
            }
        };

        conn.mark_event();

        // Response to our request
        if let Some(id_val) = parsed.get("id") {
            if parsed.get("method").is_none() {
                let id = match id_val.as_u64() {
                    Some(i) => i,
                    None => id_val.as_i64().map(|i| i as u64).unwrap_or(0),
                };
                if let Some(p) = conn.pending.lock().remove(&id) {
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

            // Server-initiated request (permission, fs, terminal, …)
            let session_id = extract_session_id(parsed.get("params"));
            let envelope = SessionEventEnvelope {
                connection_id: conn.connection_id.clone(),
                session_id,
                sequence: conn.next_sequence(),
                timestamp: iso_now(),
                source: EventSource::Acp,
                kind: "server_request".into(),
                payload: parsed.clone(),
            };
            emit_json(&bus, "acp:server_request", &envelope);
            // Also emit legacy raw shape for older UI handlers.
            emit_json(&bus, "acp:server_request_raw", &parsed);
            continue;
        }

        // Notification
        if let Some(method) = parsed.get("method").and_then(|m| m.as_str()) {
            let params = parsed.get("params").cloned().unwrap_or(Value::Null);
            let session_id = extract_session_id(Some(&params));

            let kind = if method == "session/update" {
                "session_update"
            } else if method.starts_with("x.ai/") {
                "extension"
            } else {
                "notification"
            };

            let envelope = SessionEventEnvelope {
                connection_id: conn.connection_id.clone(),
                session_id,
                sequence: conn.next_sequence(),
                timestamp: iso_now(),
                source: if method.starts_with("x.ai/") {
                    EventSource::Extension
                } else {
                    EventSource::Acp
                },
                kind: kind.into(),
                payload: if method == "session/update" {
                    params.clone()
                } else {
                    json!({ "method": method, "params": params })
                },
            };

            match kind {
                "session_update" => {
                    emit_json(&bus, "acp:session_update", &envelope);
                }
                "extension" => {
                    emit_json(&bus, "acp:extension", &envelope);
                }
                _ => {
                    emit_json(&bus, "acp:notification", &envelope);
                }
            }
        }
    }

    // Process stdout closed — fail pending and remove from pool unless explicit stop already did.
    conn.fail_all_pending(AcpError::NotRunning);
    *conn.state.lock() = ConnectionState::Stopped;
    *conn.last_error.lock() = Some("agent process exited".into());

    if !*conn.stopping.lock() {
        pool_slot.lock().remove(&conn.connection_id);
        let mut idx = key_index.lock();
        if idx.get(&key_str).map(|id| id == &conn.connection_id).unwrap_or(false) {
            idx.remove(&key_str);
        }
    }

    emit_json(
        &bus,
        "acp:status",
        AgentStatus {
            running: false,
            connection_id: Some(conn.connection_id.clone()),
            session_id: conn.active_session_id.lock().clone(),
            cwd: Some(conn.cwd.to_string_lossy().into()),
            grok_path: Some(conn.grok_path.clone()),
            last_error: Some("agent process exited".into()),
        },
    );
}

fn extract_session_id(params: Option<&Value>) -> Option<String> {
    let p = params?;
    p.get("sessionId")
        .or_else(|| p.get("session_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            // Nested update payloads sometimes only carry session on outer params.
            None
        })
}

fn emit_error(bus: &SharedEventBus, conn: &ConnectionInner, message: String) {
    let envelope = SessionEventEnvelope {
        connection_id: conn.connection_id.clone(),
        session_id: conn.active_session_id.lock().clone(),
        sequence: conn.next_sequence(),
        timestamp: iso_now(),
        source: EventSource::Runtime,
        kind: "error".into(),
        payload: json!({ "message": message }),
    };
    emit_json(bus, "acp:error", &envelope);
}

/// Re-export empty snapshot helper for pool.
pub fn empty_snapshot() -> RuntimeSnapshot {
    crate::contracts::empty_runtime_snapshot(iso_now())
}
