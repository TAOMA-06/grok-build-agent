//! Shared wire contracts mirrored for the Tauri host.
//! Field names use camelCase on the wire to match the TypeScript contracts.
//!
//! Types are consumed by later tasks (RuntimePool, persistence, review). Allow
//! unused items until those modules land.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// --- Runtime pool ---------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SandboxMode {
    None,
    Workspace,
    Strict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerProfile {
    Balanced,
    Performance,
    Efficiency,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionKey {
    pub workspace_root: String,
    pub sandbox: SandboxMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_profile: Option<PowerProfile>,
}

impl ConnectionKey {
    pub fn key_string(&self) -> String {
        let profile = match self.power_profile {
            Some(PowerProfile::Balanced) => "balanced",
            Some(PowerProfile::Performance) => "performance",
            Some(PowerProfile::Efficiency) => "efficiency",
            None => "off",
        };
        let sandbox = match self.sandbox {
            SandboxMode::None => "none",
            SandboxMode::Workspace => "workspace",
            SandboxMode::Strict => "strict",
        };
        format!("{}::{}::{}", self.workspace_root, sandbox, profile)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Starting,
    Initializing,
    Authenticating,
    Ready,
    Reconnecting,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethodSummary {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilitySnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_version: Option<String>,
    #[serde(default)]
    pub load_session: bool,
    #[serde(default)]
    pub list_sessions: bool,
    #[serde(default)]
    pub fs: bool,
    #[serde(default)]
    pub terminal: bool,
    #[serde(default)]
    pub auth_methods: Vec<AuthMethodSummary>,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub connection_id: String,
    pub key: ConnectionKey,
    pub state: ConnectionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grok_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default)]
    pub session_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<AgentCapabilitySnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_event_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub connections: Vec<ConnectionSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    pub updated_at: String,
}

// --- Session --------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionRunState {
    Idle,
    Streaming,
    AwaitingPermission,
    AwaitingPlan,
    Cancelled,
    Error,
    Ended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub workspace_root: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    pub run_state: SessionRunState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub always_approve: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<String>,
}

// --- Events ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventSource {
    Acp,
    Runtime,
    Git,
    Worktree,
    System,
    Extension,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventEnvelope {
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub sequence: u64,
    pub timestamp: String,
    pub source: EventSource,
    pub kind: String,
    pub payload: serde_json::Value,
}

// --- Permission -----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPrompt {
    pub request_id: serde_json::Value,
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub options: Vec<PermissionOption>,
    pub raw: serde_json::Value,
    pub received_at: String,
}

// --- Review / Git ---------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitRepoState {
    Clean,
    Dirty,
    NotARepo,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Binary,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFileEntry {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: ReviewFileStatus,
    pub staged: bool,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSnapshot {
    pub workspace_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub state: GitRepoState,
    pub files: Vec<ReviewFileEntry>,
    #[serde(default)]
    pub untracked: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub refreshed_at: String,
}

// --- Helpers --------------------------------------------------------------

pub fn empty_runtime_snapshot(updated_at: impl Into<String>) -> RuntimeSnapshot {
    RuntimeSnapshot {
        connections: vec![],
        active_connection_id: None,
        active_session_id: None,
        updated_at: updated_at.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn connection_key_string_matches_ts_convention() {
        let key = ConnectionKey {
            workspace_root: "/Users/me/proj".into(),
            sandbox: SandboxMode::Workspace,
            power_profile: None,
        };
        assert_eq!(key.key_string(), "/Users/me/proj::workspace::off");
    }

    #[test]
    fn runtime_snapshot_roundtrip_camel_case() {
        let snap = RuntimeSnapshot {
            connections: vec![ConnectionSnapshot {
                connection_id: "c1".into(),
                key: ConnectionKey {
                    workspace_root: "/repo".into(),
                    sandbox: SandboxMode::None,
                    power_profile: Some(PowerProfile::Balanced),
                },
                state: ConnectionState::Ready,
                grok_path: Some("/usr/local/bin/grok".into()),
                pid: Some(42),
                session_ids: vec!["s1".into()],
                capabilities: None,
                last_error: None,
                started_at: Some("2026-01-01T00:00:00.000Z".into()),
                last_event_at: None,
            }],
            active_connection_id: Some("c1".into()),
            active_session_id: Some("s1".into()),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        };
        let raw = serde_json::to_value(&snap).unwrap();
        assert_eq!(raw["connections"][0]["connectionId"], "c1");
        assert_eq!(raw["connections"][0]["key"]["workspaceRoot"], "/repo");
        assert_eq!(raw["activeSessionId"], "s1");
        let back: RuntimeSnapshot = serde_json::from_value(raw).unwrap();
        assert_eq!(back.connections[0].connection_id, "c1");
    }

    #[test]
    fn session_event_envelope_roundtrip() {
        let env = SessionEventEnvelope {
            connection_id: "c1".into(),
            session_id: Some("s1".into()),
            sequence: 9,
            timestamp: "2026-01-01T00:00:00.000Z".into(),
            source: EventSource::Acp,
            kind: "session_update".into(),
            payload: json!({ "sessionUpdate": "agent_message_chunk" }),
        };
        let raw = serde_json::to_value(&env).unwrap();
        assert_eq!(raw["connectionId"], "c1");
        assert_eq!(raw["sequence"], 9);
        assert_eq!(raw["source"], "acp");
        let back: SessionEventEnvelope = serde_json::from_value(raw).unwrap();
        assert_eq!(back.sequence, 9);
    }

    #[test]
    fn permission_prompt_preserves_agent_option_ids() {
        let prompt = PermissionPrompt {
            request_id: json!(7),
            connection_id: "c1".into(),
            session_id: Some("s1".into()),
            method: "session/request_permission".into(),
            tool_call_id: Some("tc-1".into()),
            title: Some("Write".into()),
            description: None,
            options: vec![PermissionOption {
                option_id: "allow-this-session".into(),
                name: "Allow this session".into(),
                kind: "allow_always".into(),
                description: None,
            }],
            raw: json!({}),
            received_at: "2026-01-01T00:00:00.000Z".into(),
        };
        let raw = serde_json::to_value(&prompt).unwrap();
        assert_eq!(raw["options"][0]["optionId"], "allow-this-session");
        // Must not invent a hardcoded allow-once when agent used another id.
        assert_ne!(raw["options"][0]["optionId"], "allow-once");
    }

    #[test]
    fn review_snapshot_states() {
        for state in [
            GitRepoState::Clean,
            GitRepoState::Dirty,
            GitRepoState::NotARepo,
            GitRepoState::Error,
        ] {
            let snap = ReviewSnapshot {
                workspace_root: "/r".into(),
                repo_root: None,
                head: None,
                branch: None,
                state,
                files: vec![],
                untracked: vec![],
                error: None,
                refreshed_at: "t".into(),
            };
            let raw = serde_json::to_value(&snap).unwrap();
            let back: ReviewSnapshot = serde_json::from_value(raw).unwrap();
            assert_eq!(back.state, snap.state);
        }
    }

    #[test]
    fn session_summary_roundtrip() {
        let row = SessionSummary {
            session_id: "local-1".into(),
            connection_id: None,
            workspace_root: "/repo".into(),
            title: "Fix".into(),
            created_at: "t0".into(),
            updated_at: "t1".into(),
            last_message_preview: None,
            run_state: SessionRunState::Idle,
            remote_session_id: None,
            worktree_path: None,
            model: Some("grok-build".into()),
            always_approve: false,
            draft: Some("hello".into()),
        };
        let raw = serde_json::to_value(&row).unwrap();
        assert_eq!(raw["sessionId"], "local-1");
        assert_eq!(raw["runState"], "idle");
        let back: SessionSummary = serde_json::from_value(raw).unwrap();
        assert_eq!(back.draft.as_deref(), Some("hello"));
    }
}
