//! RuntimePool: one ACP child per (workspace, sandbox, power profile).

use super::connection::{
    connection_key_from_config, iso_now, normalize_workspace, spawn_connection, ConnectionInner,
};
use super::events::{emit_json, SharedEventBus, TauriEventBus};
use super::{default_harness_rules, AcpError, AgentStatus, StartConfig};
use crate::contracts::{ConnectionState, RuntimeSnapshot};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Runtime as TauriRuntime};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Default)]
pub struct RuntimePool {
    /// connection_id → connection
    connections: Arc<Mutex<HashMap<String, Arc<ConnectionInner>>>>,
    /// ConnectionKey.key_string() → connection_id
    key_index: Arc<Mutex<HashMap<String, String>>>,
    active_connection_id: Arc<Mutex<Option<String>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl RuntimePool {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        let active_connection_id = self.active_connection_id.lock().clone();
        let connections = self.connections.lock();
        let list: Vec<_> = connections.values().map(|c| c.snapshot()).collect();
        let active_session_id = active_connection_id
            .as_ref()
            .and_then(|id| connections.get(id))
            .and_then(|c| c.active_session_id.lock().clone());
        RuntimeSnapshot {
            connections: list,
            active_connection_id,
            active_session_id,
            updated_at: iso_now(),
        }
    }

    pub fn status(&self) -> AgentStatus {
        match self.active_connection() {
            Some(c) => AgentStatus {
                running: matches!(
                    *c.state.lock(),
                    ConnectionState::Ready
                        | ConnectionState::Initializing
                        | ConnectionState::Authenticating
                        | ConnectionState::Starting
                        | ConnectionState::Reconnecting
                ),
                connection_id: Some(c.connection_id.clone()),
                session_id: c.active_session_id.lock().clone(),
                cwd: Some(c.cwd.to_string_lossy().into()),
                grok_path: Some(c.grok_path.clone()),
                last_error: c
                    .last_error
                    .lock()
                    .clone()
                    .or_else(|| self.last_error.lock().clone()),
            },
            None => AgentStatus {
                running: false,
                connection_id: None,
                session_id: None,
                cwd: None,
                grok_path: None,
                last_error: self.last_error.lock().clone(),
            },
        }
    }

    fn active_connection(&self) -> Option<Arc<ConnectionInner>> {
        let id = self.active_connection_id.lock().clone()?;
        self.connections.lock().get(&id).cloned()
    }

    fn get_connection(&self, connection_id: &str) -> Result<Arc<ConnectionInner>, AcpError> {
        self.connections
            .lock()
            .get(connection_id)
            .cloned()
            .ok_or(AcpError::NotRunning)
    }

    /// Ensure a connection for the config key; create a session; set active.
    pub async fn start<R: TauriRuntime>(
        &self,
        app: AppHandle<R>,
        config: StartConfig,
    ) -> Result<AgentStatus, AcpError> {
        let bus: SharedEventBus = Arc::new(TauriEventBus::new(app));
        self.start_with_bus(bus, config).await
    }

    pub async fn start_with_bus(
        &self,
        bus: SharedEventBus,
        config: StartConfig,
    ) -> Result<AgentStatus, AcpError> {
        let workspace = normalize_workspace(&config.cwd)?;
        let key = connection_key_from_config(&config, workspace.clone());
        let key_str = key.key_string();

        // Reuse existing connection for the same pool key when still live.
        let existing = {
            let idx = self.key_index.lock();
            idx.get(&key_str).cloned()
        };
        let conn = if let Some(id) = existing {
            if let Ok(c) = self.get_connection(&id) {
                c
            } else {
                self.spawn_new(bus.clone(), config.clone()).await?
            }
        } else {
            self.spawn_new(bus.clone(), config.clone()).await?
        };

        // Initialize handshake if still starting/initializing without sessions.
        if conn.session_ids.lock().is_empty() {
            self.initialize_and_open_session(&conn, &config).await?;
        } else if conn.active_session_id.lock().is_none() {
            // Reuse first session or create new.
            let first = conn.session_ids.lock().iter().next().cloned();
            if let Some(s) = first {
                *conn.active_session_id.lock() = Some(s);
            } else {
                self.open_session(&conn, &config).await?;
            }
        }

        *self.active_connection_id.lock() = Some(conn.connection_id.clone());
        *self.last_error.lock() = None;
        emit_json(&bus, "acp:status", self.status());
        Ok(self.status())
    }

    async fn spawn_new(
        &self,
        bus: SharedEventBus,
        config: StartConfig,
    ) -> Result<Arc<ConnectionInner>, AcpError> {
        spawn_connection(
            bus,
            config,
            self.connections.clone(),
            self.key_index.clone(),
        )
        .await
    }

    async fn initialize_and_open_session(
        &self,
        conn: &Arc<ConnectionInner>,
        config: &StartConfig,
    ) -> Result<(), AcpError> {
        *conn.state.lock() = ConnectionState::Initializing;
        let init_result = conn
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
                Duration::from_secs(60),
            )
            .await;

        let init = match init_result {
            Ok(v) => v,
            Err(e) => {
                let msg = crate::secrets::redact_secrets(&e.to_string());
                *conn.last_error.lock() = Some(msg.clone());
                *self.last_error.lock() = Some(msg.clone());
                *conn.state.lock() = ConnectionState::Error;
                conn.kill_child().await;
                self.remove_connection(&conn.connection_id);
                return Err(AcpError::Message(format!("initialize failed: {msg}")));
            }
        };

        // Persist capability / auth method snapshot for UI + later session control.
        let caps = parse_capabilities(&init);
        *conn.capabilities.lock() = Some(caps.clone());

        // Fixed order: initialize → authenticate (when required) → session/new|load.
        *conn.state.lock() = ConnectionState::Authenticating;
        if let Err(e) = maybe_authenticate(conn, &caps).await {
            let msg = crate::secrets::redact_secrets(&e.to_string());
            *conn.last_error.lock() = Some(msg.clone());
            *self.last_error.lock() = Some(msg.clone());
            *conn.state.lock() = ConnectionState::Error;
            conn.kill_child().await;
            self.remove_connection(&conn.connection_id);
            return Err(AcpError::Message(format!("authenticate failed: {msg}")));
        }

        *conn.state.lock() = ConnectionState::Ready;
        self.open_session(conn, config).await
    }

    async fn open_session(
        &self,
        conn: &Arc<ConnectionInner>,
        config: &StartConfig,
    ) -> Result<(), AcpError> {
        let session_id = self
            .new_session_on(
                conn,
                &conn.cwd.to_string_lossy(),
                config.rules.clone(),
                config.use_harness,
                config.agent_profile.clone(),
            )
            .await?;
        *conn.active_session_id.lock() = Some(session_id);
        Ok(())
    }

    pub async fn new_session(
        &self,
        connection_id: &str,
        cwd: &str,
        rules: Option<String>,
        use_harness: bool,
        agent_profile: Option<String>,
    ) -> Result<String, AcpError> {
        let conn = self.get_connection(connection_id)?;
        let session_id = self
            .new_session_on(&conn, cwd, rules, use_harness, agent_profile)
            .await?;
        *conn.active_session_id.lock() = Some(session_id.clone());
        Ok(session_id)
    }

    async fn new_session_on(
        &self,
        conn: &Arc<ConnectionInner>,
        cwd: &str,
        rules: Option<String>,
        use_harness: bool,
        agent_profile: Option<String>,
    ) -> Result<String, AcpError> {
        let mut params = json!({
            "cwd": cwd,
            "mcpServers": []
        });

        let mut rules = rules.unwrap_or_default();
        if use_harness {
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
        if let Some(profile) = agent_profile {
            if !profile.trim().is_empty() {
                meta["agentProfile"] = Value::String(profile);
            }
        }
        if meta.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
            params["_meta"] = meta;
        }

        let session = conn
            .request("session/new", params, Duration::from_secs(60))
            .await
            .map_err(|e| {
                let msg = e.to_string();
                *conn.last_error.lock() = Some(msg.clone());
                AcpError::Message(format!("session/new failed: {msg}"))
            })?;

        let session_id = session
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                AcpError::Message(format!("session/new missing sessionId: {session}"))
            })?;

        conn.session_ids.lock().insert(session_id.clone());
        Ok(session_id)
    }

    pub async fn prompt(&self, text: &str) -> Result<Value, AcpError> {
        let conn = self.active_connection().ok_or(AcpError::NotRunning)?;
        let session_id = conn
            .active_session_id
            .lock()
            .clone()
            .ok_or_else(|| AcpError::Message("no session".into()))?;
        self.prompt_session(&conn.connection_id, &session_id, text)
            .await
    }

    pub async fn prompt_session(
        &self,
        connection_id: &str,
        session_id: &str,
        text: &str,
    ) -> Result<Value, AcpError> {
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        conn.request(
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": text }]
            }),
            DEFAULT_TIMEOUT,
        )
        .await
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        let conn = self.active_connection().ok_or(AcpError::NotRunning)?;
        conn.request(method, params, DEFAULT_TIMEOUT).await
    }

    pub async fn request_on(
        &self,
        connection_id: &str,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AcpError> {
        let conn = self.get_connection(connection_id)?;
        conn.request(method, params, timeout).await
    }

    pub async fn respond_to_request(
        &self,
        id: Value,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<(), AcpError> {
        let conn = self.active_connection().ok_or(AcpError::NotRunning)?;
        conn.respond_to_request(id, result, error).await
    }

    pub async fn respond_to_request_on(
        &self,
        connection_id: &str,
        id: Value,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<(), AcpError> {
        let conn = self.get_connection(connection_id)?;
        conn.respond_to_request(id, result, error).await
    }

    pub async fn stop(&self) -> Result<(), AcpError> {
        let id = self.active_connection_id.lock().clone();
        if let Some(id) = id {
            self.stop_connection(&id).await?;
        }
        Ok(())
    }

    pub async fn stop_connection(&self, connection_id: &str) -> Result<(), AcpError> {
        let conn = {
            let mut guard = self.connections.lock();
            guard.remove(connection_id)
        };
        if let Some(conn) = conn {
            let key_str = conn.key.key_string();
            {
                let mut idx = self.key_index.lock();
                if idx
                    .get(&key_str)
                    .map(|id| id == connection_id)
                    .unwrap_or(false)
                {
                    idx.remove(&key_str);
                }
            }
            conn.kill_child().await;
            let mut active = self.active_connection_id.lock();
            if active.as_deref() == Some(connection_id) {
                *active = None;
            }
        }
        Ok(())
    }

    pub async fn stop_all(&self) -> Result<(), AcpError> {
        let ids: Vec<String> = self.connections.lock().keys().cloned().collect();
        for id in ids {
            self.stop_connection(&id).await?;
        }
        *self.active_connection_id.lock() = None;
        Ok(())
    }

    fn remove_connection(&self, connection_id: &str) {
        if let Some(conn) = self.connections.lock().remove(connection_id) {
            let key_str = conn.key.key_string();
            let mut idx = self.key_index.lock();
            if idx
                .get(&key_str)
                .map(|id| id == connection_id)
                .unwrap_or(false)
            {
                idx.remove(&key_str);
            }
        }
        let mut active = self.active_connection_id.lock();
        if active.as_deref() == Some(connection_id) {
            *active = None;
        }
    }
}

fn parse_capabilities(init: &Value) -> crate::contracts::AgentCapabilitySnapshot {
    use crate::contracts::{AgentCapabilitySnapshot, AuthMethodSummary};
    let agent_caps = init
        .get("agentCapabilities")
        .cloned()
        .unwrap_or(Value::Null);
    let auth_methods = init
        .get("authMethods")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    Some(AuthMethodSummary {
                        id: m.get("id")?.as_str()?.to_string(),
                        name: m
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("auth")
                            .to_string(),
                        description: m
                            .get("description")
                            .and_then(|d| d.as_str())
                            .map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let models = init
        .pointer("/agentCapabilities/models")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    AgentCapabilitySnapshot {
        protocol_version: init.get("protocolVersion").cloned(),
        agent_name: init
            .pointer("/agentInfo/name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        agent_version: init
            .pointer("/agentInfo/version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        load_session: agent_caps
            .get("loadSession")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        list_sessions: agent_caps
            .get("listSessions")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        fs: true,
        terminal: true,
        auth_methods,
        models,
    }
}

async fn maybe_authenticate(
    conn: &Arc<ConnectionInner>,
    caps: &crate::contracts::AgentCapabilitySnapshot,
) -> Result<(), AcpError> {
    if caps.auth_methods.is_empty() {
        return Ok(());
    }
    // Prefer env/API key method when present; otherwise first method id.
    let method_id = caps
        .auth_methods
        .iter()
        .find(|m| {
            let id = m.id.to_lowercase();
            id.contains("api") || id.contains("key") || id.contains("env")
        })
        .or_else(|| caps.auth_methods.first())
        .map(|m| m.id.clone());

    let Some(method_id) = method_id else {
        return Ok(());
    };

    // If already authenticated via env/keychain, call authenticate; agents that
    // do not need it typically return quickly.
    match conn
        .request(
            "authenticate",
            json!({ "methodId": method_id }),
            Duration::from_secs(30),
        )
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => {
            // Soft-fail when method is optional / already signed-in via CLI auth.
            let msg = e.to_string().to_lowercase();
            if msg.contains("already")
                || msg.contains("not required")
                || msg.contains("unsupported")
            {
                Ok(())
            } else {
                // Keep going for mock agents that reject authenticate.
                if msg.contains("method not found") || msg.contains("-32601") {
                    Ok(())
                } else {
                    Err(e)
                }
            }
        }
    }
}

impl Drop for RuntimePool {
    fn drop(&mut self) {
        // Best-effort: kill children when pool is dropped (e.g. app exit).
        let conns: Vec<_> = self.connections.lock().values().cloned().collect();
        for conn in conns {
            *conn.stopping.lock() = true;
            conn.fail_all_pending(AcpError::NotRunning);
            if let Some(mut child) = conn.child.try_lock() {
                let _ = child.start_kill();
            }
        }
        self.connections.lock().clear();
        self.key_index.lock().clear();
    }
}
