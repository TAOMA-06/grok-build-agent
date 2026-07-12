//! ACP host: RuntimePool of Grok agent child processes (stdio JSON-RPC).

#![allow(dead_code)]

mod connection;
mod events;
mod fs_guard;
mod handlers;
mod pool;
pub(crate) mod terminal_host;

pub use connection::{iso_now, resolve_grok_path};
#[cfg(test)]
pub use events::NoopEventBus;
pub use events::{EventBus, SharedEventBus};
pub use pool::RuntimePool;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use crate::contracts::{PowerProfile, SandboxMode};

#[derive(Debug, Error)]
pub enum AcpError {
    #[error("{0}")]
    Message(String),
    #[error("agent is not running")]
    NotRunning,
    #[error("agent request timed out")]
    Timeout,
    #[error("request cancelled")]
    Cancelled,
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

/// Start / ensure-connection configuration (legacy + pool fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConfig {
    #[serde(default)]
    pub task_id: Option<String>,
    /// Path to the `grok` binary. Empty = search PATH.
    pub grok_path: Option<String>,
    pub model: Option<String>,
    /// CLI `--reasoning-effort` when the selected model supports it.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    pub always_approve: bool,
    pub cwd: String,
    /// Optional extra system rules (harness overlay).
    pub rules: Option<String>,
    pub agent_profile: Option<String>,
    /// When true, inject built-in orchestrator harness rules.
    pub use_harness: bool,
    #[serde(default)]
    pub sandbox: Option<SandboxMode>,
    #[serde(default)]
    pub power_profile: Option<PowerProfile>,
    /// Existing Grok session to restore instead of creating a new one.
    #[serde(default)]
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub grok_path: Option<String>,
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<crate::contracts::SessionModelState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<crate::contracts::SessionModeState>,
    #[serde(default)]
    pub available_commands: Vec<crate::contracts::AvailableCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokProbe {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Backward-compatible name for the pool-backed runtime.
pub type AcpRuntime = RuntimePool;

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
    include_str!("../../../../../harness/AGENTS.md").to_string()
}

#[cfg(test)]
pub fn handlers_is_permission_for_test(method: &str) -> bool {
    handlers::is_permission_method(method)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::SandboxMode;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    fn mock_agent_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mock_acp_agent.py")
    }

    fn temp_workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gbd-acp-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn start_cfg(cwd: &std::path::Path, mock: &std::path::Path) -> StartConfig {
        StartConfig {
            task_id: Some("test-task".into()),
            grok_path: Some(mock.to_string_lossy().into()),
            model: None,
            reasoning_effort: None,
            always_approve: false,
            cwd: cwd.to_string_lossy().into(),
            rules: None,
            agent_profile: None,
            use_harness: false,
            sandbox: Some(SandboxMode::None),
            power_profile: None,
            resume_session_id: None,
        }
    }

    fn noop_bus() -> SharedEventBus {
        Arc::new(NoopEventBus)
    }

    #[tokio::test]
    async fn two_workspaces_multiple_sessions_isolated() {
        let mock = mock_agent_path();
        assert!(mock.exists(), "mock agent missing at {}", mock.display());

        let ws_a = temp_workspace("a");
        let ws_b = temp_workspace("b");
        let pool = RuntimePool::new();
        let bus = noop_bus();

        let st_a = pool
            .start_with_bus(bus.clone(), start_cfg(&ws_a, &mock))
            .await
            .expect("start A");
        assert!(st_a.running);
        let conn_a = st_a.connection_id.clone().expect("conn A");
        let sess_a1 = st_a.session_id.clone().expect("sess A1");

        let st_b = pool
            .start_with_bus(bus.clone(), start_cfg(&ws_b, &mock))
            .await
            .expect("start B");
        assert!(st_b.running);
        let conn_b = st_b.connection_id.clone().expect("conn B");
        let sess_b1 = st_b.session_id.clone().expect("sess B1");

        assert_ne!(conn_a, conn_b, "workspaces must use different connections");

        let sess_a2 = pool
            .new_session(&conn_a, &ws_a.to_string_lossy(), None, false, None)
            .await
            .expect("second session on A");
        assert_ne!(sess_a1, sess_a2);

        let r_a1 = pool
            .prompt_session(&conn_a, &sess_a1, "hello-a1")
            .await
            .unwrap();
        let r_a2 = pool
            .prompt_session(&conn_a, &sess_a2, "hello-a2")
            .await
            .unwrap();
        let r_b1 = pool
            .prompt_session(&conn_b, &sess_b1, "hello-b1")
            .await
            .unwrap();

        assert_eq!(
            r_a1.get("echoSessionId").and_then(|v| v.as_str()),
            Some(sess_a1.as_str())
        );
        assert_eq!(
            r_a2.get("echoSessionId").and_then(|v| v.as_str()),
            Some(sess_a2.as_str())
        );
        assert_eq!(
            r_b1.get("echoSessionId").and_then(|v| v.as_str()),
            Some(sess_b1.as_str())
        );

        let snap = pool.snapshot();
        assert_eq!(snap.connections.len(), 2);
        for c in &snap.connections {
            assert!(!c.session_ids.is_empty());
        }

        pool.stop_all().await.unwrap();
        assert!(pool.snapshot().connections.is_empty());
    }

    #[tokio::test]
    async fn process_exit_fails_pending_and_cleans_up() {
        let mock = mock_agent_path();
        let ws = temp_workspace("exit");
        let pool = RuntimePool::new();

        let st = pool
            .start_with_bus(noop_bus(), start_cfg(&ws, &mock))
            .await
            .expect("start");
        let conn = st.connection_id.unwrap();
        let sess = st.session_id.unwrap();

        let hang = pool.request_on(
            &conn,
            "mock/hang",
            json!({ "sessionId": sess }),
            Duration::from_secs(5),
        );
        tokio::time::sleep(Duration::from_millis(50)).await;

        let _ = pool
            .request_on(&conn, "mock/exit", json!({}), Duration::from_secs(2))
            .await;

        let hang_result = hang.await;
        assert!(
            hang_result.is_err(),
            "pending must fail after process exit, got {hang_result:?}"
        );

        tokio::time::sleep(Duration::from_millis(100)).await;
        let status = pool.status();
        assert!(!status.running || pool.snapshot().connections.is_empty());

        pool.stop_all().await.unwrap();
    }

    #[tokio::test]
    async fn stop_does_not_leave_orphan_process() {
        let mock = mock_agent_path();
        let ws = temp_workspace("orphan");
        let pool = RuntimePool::new();

        let st = pool
            .start_with_bus(noop_bus(), start_cfg(&ws, &mock))
            .await
            .expect("start");
        let pid = pool
            .snapshot()
            .connections
            .iter()
            .find(|c| c.connection_id == st.connection_id.clone().unwrap())
            .and_then(|c| c.pid)
            .expect("pid");

        pool.stop_all().await.unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;

        let still_alive = std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(!still_alive, "child pid {pid} still alive after stop");
    }
}
