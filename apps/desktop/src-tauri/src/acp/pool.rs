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
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Runtime as TauriRuntime};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);
const PROJECT_RULES_MAX_BYTES: usize = 32 * 1024;

/// Load a bounded AGENTS.md (or Agents.md) from the workspace for session rules.
fn load_project_rules(cwd: &str) -> Option<String> {
    let root = Path::new(cwd);
    for name in ["AGENTS.md", "Agents.md", "agents.md"] {
        let path = root.join(name);
        let Some(meta) = std::fs::metadata(&path).ok() else {
            continue;
        };
        if !meta.is_file() || meta.len() == 0 {
            continue;
        }
        let Some(raw) = std::fs::read(&path).ok() else {
            continue;
        };
        if raw.is_empty() {
            continue;
        }
        let slice = if raw.len() > PROJECT_RULES_MAX_BYTES {
            &raw[..PROJECT_RULES_MAX_BYTES]
        } else {
            &raw[..]
        };
        let text = String::from_utf8_lossy(slice);
        let body = text.trim();
        if body.is_empty() {
            continue;
        }
        return Some(format!(
            "# Project rules ({name})\n\n{body}\n"
        ));
    }
    None
}

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
            Some(c) => {
                let caps = c.capabilities.lock().clone();
                let current = caps
                    .as_ref()
                    .and_then(|cap| cap.current_model_id.clone())
                    .or_else(|| c.key.model_id.clone());
                let active_session_id = c.active_session_id.lock().clone();
                let mode = active_session_id
                    .as_deref()
                    .map(|session_id| c.session_mode_state(session_id));
                let available_commands = caps
                    .as_ref()
                    .map(|cap| cap.available_commands.clone())
                    .unwrap_or_default();
                let available = caps
                    .as_ref()
                    .map(|cap| {
                        cap.models
                            .iter()
                            .map(|id| {
                                crate::contracts::SelectableModel::named(
                                    id.clone(),
                                    id.clone(),
                                    current.as_deref() == Some(id.as_str()),
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let live_switch_supported = caps
                    .as_ref()
                    .map(|cap| !cap.models.is_empty())
                    .unwrap_or(false);
                AgentStatus {
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
                    model: Some(crate::contracts::SessionModelState {
                        current_model_id: current,
                        available_models: available,
                        live_switch_supported,
                        source: if live_switch_supported {
                            "acp".into()
                        } else {
                            "configured".into()
                        },
                    }),
                    mode,
                    available_commands,
                }
            }
            None => AgentStatus {
                running: false,
                connection_id: None,
                session_id: None,
                cwd: None,
                grok_path: None,
                last_error: self.last_error.lock().clone(),
                model: None,
                mode: None,
                available_commands: vec![],
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

        // Initialize a new child once. Every subsequent `start` explicitly
        // creates or restores the requested session; never silently reuse an
        // arbitrary active session from the same workspace.
        if conn.session_ids.lock().is_empty() {
            self.initialize_and_open_session(&conn, &config).await?;
        } else if let Some(session_id) = config.resume_session_id.as_deref() {
            self.restore_or_open_session(&conn, session_id, &config)
                .await?;
        } else {
            self.open_session(&conn, &config).await?;
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
        if let Some(session_id) = config.resume_session_id.as_deref() {
            self.restore_or_open_session(conn, session_id, config).await
        } else {
            self.open_session(conn, config).await
        }
    }

    /// Resume persisted ACP sessions when the agent advertises support. Some
    /// compatible agents only implement `session/new`; in that case retain the
    /// local transcript and attach it to a fresh remote session instead of
    /// making a saved row impossible to open.
    async fn restore_or_open_session(
        &self,
        conn: &Arc<ConnectionInner>,
        session_id: &str,
        config: &StartConfig,
    ) -> Result<(), AcpError> {
        let can_load = conn
            .capabilities
            .lock()
            .as_ref()
            .map(|caps| caps.load_session)
            .unwrap_or(false);
        if can_load {
            self.load_session_on(conn, session_id).await
        } else {
            self.open_session(conn, config).await
        }
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
        if let Some(project_rules) = load_project_rules(cwd) {
            if rules.is_empty() {
                rules = project_rules;
            } else {
                rules = format!("{rules}\n\n{project_rules}");
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

        update_session_capabilities(conn, &session_id, &session);
        conn.session_ids.lock().insert(session_id.clone());
        Ok(session_id)
    }

    async fn load_session_on(
        &self,
        conn: &Arc<ConnectionInner>,
        session_id: &str,
    ) -> Result<(), AcpError> {
        let supports_load = conn
            .capabilities
            .lock()
            .as_ref()
            .map(|caps| caps.load_session)
            .unwrap_or(false);
        if !supports_load {
            return Err(AcpError::Message(
                "this Grok CLI does not advertise ACP session/load".into(),
            ));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AcpError::Message("session id is empty".into()));
        }
        let response = conn
            .request(
                "session/load",
                json!({
                    "sessionId": session_id,
                    "cwd": conn.cwd,
                    "mcpServers": [],
                }),
                Duration::from_secs(60),
            )
            .await
            .map_err(|e| AcpError::Message(format!("session/load failed: {e}")))?;
        update_session_capabilities(conn, session_id, &response);
        conn.session_ids.lock().insert(session_id.to_string());
        *conn.active_session_id.lock() = Some(session_id.to_string());
        Ok(())
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
        self.prompt_session_content(
            connection_id,
            session_id,
            crate::contracts::PromptContent::text_only(text),
        )
        .await
    }

    pub async fn prompt_session_content(
        &self,
        connection_id: &str,
        session_id: &str,
        content: Vec<crate::contracts::PromptContent>,
    ) -> Result<Value, AcpError> {
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        let prompt: Vec<Value> = content.iter().map(|c| c.to_acp_value()).collect();
        conn.request(
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": prompt
            }),
            DEFAULT_TIMEOUT,
        )
        .await
    }

    /// Try ACP live model switch; returns Ok(true) when the agent accepted.
    pub async fn set_session_model(
        &self,
        connection_id: &str,
        session_id: &str,
        model_id: &str,
    ) -> Result<crate::contracts::SessionModelState, AcpError> {
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err(AcpError::Message("model id empty".into()));
        }

        let mut live_ok = false;
        // Prefer session/set_model; fall back to session/set_config_option.
        for (method, params) in [
            (
                "session/set_model",
                json!({ "sessionId": session_id, "modelId": model_id }),
            ),
            (
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": "model",
                    "value": model_id
                }),
            ),
        ] {
            match conn.request(method, params, Duration::from_secs(15)).await {
                Ok(_) => {
                    live_ok = true;
                    break;
                }
                Err(_) => continue,
            }
        }

        let caps = conn.capabilities.lock().clone();
        let available = caps
            .as_ref()
            .map(|c| {
                c.models
                    .iter()
                    .map(|id| {
                        crate::contracts::SelectableModel::named(
                            id.clone(),
                            id.clone(),
                            id == model_id,
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(crate::contracts::SessionModelState {
            current_model_id: Some(model_id.to_string()),
            available_models: available,
            live_switch_supported: live_ok,
            source: if live_ok {
                "acp".into()
            } else {
                "configured".into()
            },
        })
    }

    /// Try ACP live reasoning-effort switch; otherwise ask the UI to restart.
    pub async fn set_session_effort(
        &self,
        connection_id: &str,
        session_id: &str,
        effort: &str,
    ) -> Result<crate::contracts::EffortSwitchResult, AcpError> {
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        let effort = effort.trim();
        if effort.is_empty() {
            return Err(AcpError::Message("reasoning effort empty".into()));
        }

        for (method, params) in [
            (
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": "reasoning_effort",
                    "value": effort
                }),
            ),
            (
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": "effort",
                    "value": effort
                }),
            ),
        ] {
            if conn
                .request(method, params, Duration::from_secs(15))
                .await
                .is_ok()
            {
                return Ok(crate::contracts::EffortSwitchResult::Switched {
                    effort: effort.to_string(),
                    live_switch_supported: true,
                });
            }
        }

        Ok(crate::contracts::EffortSwitchResult::RestartRequired {
            effort: effort.to_string(),
            reason: "This Grok CLI cannot change reasoning effort in a live session; the agent will restart.".into(),
        })
    }

    pub async fn set_session_mode(
        &self,
        connection_id: &str,
        session_id: &str,
        requested_mode: &str,
    ) -> Result<crate::contracts::ModeSwitchResult, AcpError> {
        use crate::contracts::ModeSwitchResult;
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        let requested_mode = requested_mode.trim().to_lowercase();
        if !matches!(requested_mode.as_str(), "agent" | "plan" | "goal") {
            return Ok(ModeSwitchResult::Unsupported {
                reason: format!("Unknown task mode: {requested_mode}"),
            });
        }
        let current = conn.session_mode_state(session_id);
        if current.current_mode == requested_mode {
            return Ok(ModeSwitchResult::Switched { state: current });
        }

        let candidates: &[&str] = match requested_mode.as_str() {
            "agent" => &["agent", "code", "default"],
            "plan" => &["plan", "architect"],
            "goal" => &["goal"],
            _ => &[],
        };
        let remote_value = current
            .available_modes
            .iter()
            .find(|mode| {
                candidates
                    .iter()
                    .any(|candidate| mode.id.eq_ignore_ascii_case(candidate))
            })
            .map(|mode| mode.id.clone());

        if let Some(value) = remote_value {
            let config_id = conn.session_mode_config_ids.lock().get(session_id).cloned();
            let (method, params) = if let Some(config_id) = config_id {
                (
                    "session/set_config_option",
                    json!({ "sessionId": session_id, "configId": config_id, "value": value }),
                )
            } else {
                (
                    "session/set_mode",
                    json!({ "sessionId": session_id, "mode": value }),
                )
            };
            match conn.request(method, params, Duration::from_secs(15)).await {
                Ok(response) => {
                    update_session_capabilities(&conn, session_id, &response);
                    let mut state = conn.session_mode_state(session_id);
                    state.current_mode = requested_mode;
                    state.live_switch_supported = true;
                    state.source = "acp_config".into();
                    conn.record_session_mode(session_id, state.clone());
                    return Ok(ModeSwitchResult::Switched { state });
                }
                Err(error) => {
                    return Ok(ModeSwitchResult::Unsupported {
                        reason: format!("Grok rejected the live mode switch: {error}"),
                    });
                }
            }
        }

        let command = match requested_mode.as_str() {
            "plan" => "/plan".to_string(),
            "goal" => "/goal".to_string(),
            "agent" if current.current_mode == "goal" => "/goal clear".to_string(),
            "agent" => "Exit plan mode and return to normal Agent mode. Do not make changes until I send the next instruction.".to_string(),
            _ => String::new(),
        };
        Ok(ModeSwitchResult::CommandRequired {
            command,
            reason: "This Grok ACP session does not advertise a live mode selector.".into(),
        })
    }

    pub fn confirm_session_mode(
        &self,
        connection_id: &str,
        session_id: &str,
        mode: &str,
    ) -> Result<crate::contracts::SessionModeState, AcpError> {
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        let mut state = conn.session_mode_state(session_id);
        state.current_mode = mode.to_string();
        state.source = "acp_command".into();
        state.live_switch_supported = false;
        conn.record_session_mode(session_id, state.clone());
        Ok(state)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        let conn = self.active_connection().ok_or(AcpError::NotRunning)?;
        conn.request(method, params, DEFAULT_TIMEOUT).await
    }

    /// Apply Grok Privacy Mode (coding data retention opt-out) on the active agent.
    /// Maps to CLI `/privacy opt-out|opt-in` via `x.ai/privacy/setCodingDataRetention`.
    pub async fn set_coding_data_privacy(&self, privacy_mode_on: bool) -> Result<Value, AcpError> {
        let conn = self.active_connection().ok_or(AcpError::NotRunning)?;
        // `privacy_mode_on == true` means opt out of training/retention (Privacy Mode).
        let opt_out = privacy_mode_on;
        let params_candidates = [
            json!({ "codingDataRetentionOptOut": opt_out }),
            json!({ "optOut": opt_out }),
            json!({ "coding_data_retention_opt_out": opt_out }),
        ];
        let mut last_err = AcpError::Message(
            "x.ai/privacy/setCodingDataRetention failed with all known param shapes".into(),
        );
        for params in params_candidates {
            match conn
                .request(
                    "x.ai/privacy/setCodingDataRetention",
                    params,
                    Duration::from_secs(20),
                )
                .await
            {
                Ok(value) => {
                    return Ok(json!({
                        "ok": true,
                        "privacyMode": privacy_mode_on,
                        "codingDataRetentionOptOut": opt_out,
                        "result": value,
                    }));
                }
                Err(err) => last_err = err,
            }
        }
        Err(last_err)
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

    pub fn cancel_session(&self, connection_id: &str, session_id: &str) -> Result<(), AcpError> {
        let conn = self.get_connection(connection_id)?;
        if !conn.session_ids.lock().contains(session_id) {
            return Err(AcpError::Message(format!(
                "session {session_id} not found on connection {connection_id}"
            )));
        }
        conn.terminals.cancel_task(session_id);
        conn.notify("session/cancel", json!({ "sessionId": session_id }))
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

fn parse_available_commands(value: &Value) -> Vec<crate::contracts::AvailableCommand> {
    value
        .as_array()
        .map(|commands| {
            commands
                .iter()
                .filter_map(|command| {
                    let name = command.get("name")?.as_str()?.trim();
                    if name.is_empty() {
                        return None;
                    }
                    Some(crate::contracts::AvailableCommand {
                        name: name.to_string(),
                        description: command
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        input: command
                            .get("input")
                            .cloned()
                            .filter(|input| !input.is_null()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_selectable_modes(value: &Value) -> Vec<crate::contracts::SelectableMode> {
    value
        .as_array()
        .map(|modes| {
            modes
                .iter()
                .filter_map(|mode| {
                    let id = mode
                        .get("id")
                        .or_else(|| mode.get("value"))
                        .and_then(Value::as_str)?;
                    Some(crate::contracts::SelectableMode {
                        id: id.to_string(),
                        name: mode
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or(id)
                            .to_string(),
                        description: mode
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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
    let mut models = init
        .pointer("/agentCapabilities/models")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let model_state = init.pointer("/_meta/modelState").unwrap_or(&Value::Null);
    let current_model_id = model_state
        .get("currentModelId")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(available) = model_state.get("availableModels").and_then(Value::as_array) {
        models = available
            .iter()
            .filter_map(|model| {
                model
                    .get("modelId")
                    .or_else(|| model.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect();
    }
    let available_commands = parse_available_commands(
        init.pointer("/_meta/availableCommands")
            .or_else(|| init.get("availableCommands"))
            .unwrap_or(&Value::Null),
    );
    let available_modes = parse_selectable_modes(
        init.get("availableModes")
            .or_else(|| init.pointer("/_meta/availableModes"))
            .unwrap_or(&Value::Null),
    );
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
        current_model_id,
        available_commands,
        available_modes,
    }
}

fn update_session_capabilities(conn: &Arc<ConnectionInner>, session_id: &str, response: &Value) {
    if let Some(commands) = response
        .get("availableCommands")
        .or_else(|| response.pointer("/_meta/availableCommands"))
    {
        let commands = parse_available_commands(commands);
        if !commands.is_empty() {
            if let Some(capabilities) = conn.capabilities.lock().as_mut() {
                capabilities.available_commands = commands;
            }
        }
    }

    let config_options = response
        .get("configOptions")
        .or_else(|| response.pointer("/_meta/configOptions"))
        .and_then(Value::as_array);
    if let Some(config) = config_options.and_then(|options| {
        options.iter().find(|option| {
            option.get("category").and_then(Value::as_str) == Some("mode")
                || option
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| id.eq_ignore_ascii_case("mode"))
                    .unwrap_or(false)
        })
    }) {
        let config_id = config
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("mode")
            .to_string();
        let available_modes = parse_selectable_modes(config.get("options").unwrap_or(&Value::Null));
        let current_mode = config
            .get("currentValue")
            .and_then(Value::as_str)
            .unwrap_or("agent")
            .to_string();
        conn.session_mode_config_ids
            .lock()
            .insert(session_id.to_string(), config_id);
        conn.record_session_mode(
            session_id,
            crate::contracts::SessionModeState {
                current_mode,
                available_modes,
                live_switch_supported: true,
                source: "acp_config".into(),
            },
        );
        return;
    }

    let available_modes = parse_selectable_modes(
        response
            .get("availableModes")
            .or_else(|| response.pointer("/_meta/availableModes"))
            .unwrap_or(&Value::Null),
    );
    if !available_modes.is_empty() {
        let current_mode = response
            .get("currentModeId")
            .or_else(|| response.get("currentMode"))
            .and_then(Value::as_str)
            .unwrap_or("agent")
            .to_string();
        conn.record_session_mode(
            session_id,
            crate::contracts::SessionModeState {
                current_mode,
                available_modes,
                live_switch_supported: true,
                source: "acp_config".into(),
            },
        );
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

#[cfg(test)]
mod capability_tests {
    use super::*;

    #[test]
    fn parses_grok_0293_meta_models_and_commands() {
        let value = json!({
            "protocolVersion": 1,
            "agentCapabilities": { "loadSession": true },
            "authMethods": [],
            "_meta": {
                "modelState": {
                    "currentModelId": "grok-4.5",
                    "availableModels": [
                        { "modelId": "grok-4.5", "name": "Grok 4.5" },
                        { "modelId": "grok-build", "name": "Grok Build" }
                    ]
                },
                "availableCommands": [
                    { "name": "compact", "description": "Compact history" },
                    { "name": "goal", "input": { "hint": "<objective>" } }
                ]
            }
        });
        let parsed = parse_capabilities(&value);
        assert_eq!(parsed.current_model_id.as_deref(), Some("grok-4.5"));
        assert_eq!(parsed.models, vec!["grok-4.5", "grok-build"]);
        assert_eq!(parsed.available_commands.len(), 2);
        assert_eq!(parsed.available_commands[1].name, "goal");
    }

    #[test]
    fn parses_mode_values_from_config_options() {
        let modes = parse_selectable_modes(&json!([
            { "value": "agent", "name": "Agent" },
            { "value": "plan", "name": "Plan" },
            { "value": "goal", "name": "Goal" }
        ]));
        assert_eq!(modes.len(), 3);
        assert_eq!(modes[1].id, "plan");
    }

    #[test]
    fn load_project_rules_skips_missing_primary_and_finds_lowercase() {
        let dir = std::env::temp_dir().join(format!(
            "gb-project-rules-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // Empty dir: no rules — metadata miss must not short-circuit into a panic/error.
        assert!(load_project_rules(dir.to_str().unwrap()).is_none());
        let rules_path = dir.join("agents.md");
        std::fs::write(&rules_path, " Prefer worktrees.\n").unwrap();
        let loaded = load_project_rules(dir.to_str().unwrap()).expect("should find agents rules");
        assert!(loaded.contains("Prefer worktrees."));
        assert!(loaded.contains("# Project rules ("));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
