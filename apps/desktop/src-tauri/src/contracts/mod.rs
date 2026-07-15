//! Shared wire contracts mirrored for the Tauri host.
//! Field names use camelCase on the wire to match the TypeScript contracts.
//!
//! Types are consumed by later tasks (RuntimePool, persistence, review). Allow
//! unused items until those modules land.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::json;

// --- Runtime pool ---------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SandboxMode {
    None,
    #[default]
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
    /// Grok approval is process-scoped, so ask/yolo sessions must not share a process.
    #[serde(default)]
    pub always_approve: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_profile: Option<PowerProfile>,
    /// Model id used at process spawn; prevents reuse when live switch is unavailable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Reasoning effort used at process spawn (`--reasoning-effort`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    /// Strict and Standard processes must never be pooled together because
    /// the CLI reads privacy controls only at process startup.
    #[serde(default = "default_connection_privacy_mode")]
    pub privacy_mode: String,
    /// Private sessions must not share an event bus with durable sessions.
    #[serde(default)]
    pub private_chat: bool,
}

fn default_connection_privacy_mode() -> String {
    "strict".into()
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
        let approval = if self.always_approve {
            "approve"
        } else {
            "ask"
        };
        let model = self
            .model_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("default");
        let effort = self
            .reasoning_effort
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("default");
        let privacy = if self.privacy_mode.eq_ignore_ascii_case("standard") {
            "standard"
        } else {
            "strict"
        };
        let retention = if self.private_chat {
            "private"
        } else {
            "durable"
        };
        format!(
            "{}::{}::{}::{privacy}::{approval}::{model}::{effort}::{retention}",
            self.workspace_root, sandbox, profile,
        )
    }
}

// --- Models ----------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffortOption {
    pub id: String,
    pub value: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectableModel {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default)]
    pub supports_reasoning_effort: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<ReasoningEffortOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_compact_threshold_percent: Option<u8>,
}

impl SelectableModel {
    pub fn named(id: impl Into<String>, name: impl Into<String>, is_default: bool) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: None,
            is_default,
            tags: Vec::new(),
            context_window: None,
            supports_reasoning_effort: false,
            reasoning_effort: None,
            reasoning_efforts: Vec::new(),
            auto_compact_threshold_percent: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModelState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_model_id: Option<String>,
    #[serde(default)]
    pub available_models: Vec<SelectableModel>,
    #[serde(default)]
    pub live_switch_supported: bool,
    /// "acp" | "cli" | "configured"
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModelSwitchResult {
    Switched { state: SessionModelState },
    NewSessionRequired { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EffortSwitchResult {
    Switched {
        effort: String,
        #[serde(default)]
        live_switch_supported: bool,
    },
    RestartRequired {
        effort: String,
        reason: String,
    },
}

// --- Session modes / commands ---------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectableMode {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeState {
    pub current_mode: String,
    #[serde(default)]
    pub available_modes: Vec<SelectableMode>,
    #[serde(default)]
    pub live_switch_supported: bool,
    /// "acp_config" | "acp_command" | "desktop"
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModeSwitchResult {
    Switched { state: SessionModeState },
    CommandRequired { command: String, reason: String },
    Unsupported { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommand {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
}

// --- Prompt content (ACP) --------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PromptContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
    },
    #[serde(rename = "resource")]
    Resource { resource: PromptResource },
    #[serde(rename = "resource_link")]
    ResourceLink {
        uri: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, rename = "mimeType", skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResource {
    pub uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAttachmentRef {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

impl PromptContent {
    pub fn text_only(text: &str) -> Vec<Self> {
        vec![PromptContent::Text {
            text: text.to_string(),
        }]
    }

    pub fn to_acp_value(&self) -> serde_json::Value {
        match self {
            PromptContent::Text { text } => json!({ "type": "text", "text": text }),
            PromptContent::Image {
                data,
                mime_type,
                uri,
            } => {
                let mut v = json!({
                    "type": "image",
                    "data": data,
                    "mimeType": mime_type,
                });
                if let Some(u) = uri {
                    v["uri"] = json!(u);
                }
                v
            }
            PromptContent::Resource { resource } => {
                json!({
                    "type": "resource",
                    "resource": {
                        "uri": resource.uri,
                        "mimeType": resource.mime_type,
                        "text": resource.text,
                        "blob": resource.blob,
                    }
                })
            }
            PromptContent::ResourceLink {
                uri,
                name,
                mime_type,
                description,
            } => {
                let mut v = json!({ "type": "resource_link", "uri": uri });
                if let Some(n) = name {
                    v["name"] = json!(n);
                }
                if let Some(m) = mime_type {
                    v["mimeType"] = json!(m);
                }
                if let Some(d) = description {
                    v["description"] = json!(d);
                }
                v
            }
        }
    }
}

// --- MCP -------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum McpTransport {
    Stdio,
    Http,
    Sse,
}

impl McpTransport {
    pub fn as_str(self) -> &'static str {
        match self {
            McpTransport::Stdio => "stdio",
            McpTransport::Http => "http",
            McpTransport::Sse => "sse",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum McpScope {
    User,
    Project,
}

impl McpScope {
    pub fn as_str(self) -> &'static str {
        match self {
            McpScope::User => "user",
            McpScope::Project => "project",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSecretField {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// keep | replace | delete
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    pub name: String,
    pub scope: McpScope,
    pub transport: McpTransport,
    pub command_or_url: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<McpSecretField>,
    #[serde(default)]
    pub headers: Vec<McpSecretField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSummary {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDoctorResult {
    pub name: String,
    pub ok: bool,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub tools: Vec<McpToolSummary>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub transport: McpTransport,
    pub scope: McpScope,
    pub display_target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env_keys: Vec<String>,
    #[serde(default)]
    pub header_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_doctor: Option<McpDoctorResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListResult {
    pub servers: Vec<McpServerInfo>,
    pub user_config_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_config_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_model_id: Option<String>,
    #[serde(default)]
    pub available_commands: Vec<AvailableCommand>,
    #[serde(default)]
    pub available_modes: Vec<SelectableMode>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskMode {
    #[default]
    Agent,
    Plan,
    Goal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PermissionPolicy {
    #[default]
    WorkspaceEdit,
    AskAll,
    FullAuto,
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
    pub execution_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_commit: Option<String>,
    #[serde(default)]
    pub mode: TaskMode,
    #[serde(default)]
    pub permission_policy: PermissionPolicy,
    #[serde(default)]
    pub sandbox: SandboxMode,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub attention_required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub always_approve: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened_at: String,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InspectorSelection {
    Tool {
        tool_call_id: String,
    },
    Terminal {
        terminal_id: String,
    },
    Plan,
    Diff {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    Diagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUiState {
    pub session_id: String,
    pub scroll_top: f64,
    pub draft: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inspector_selection: Option<InspectorSelection>,
    #[serde(default)]
    pub collapsed_tool_ids: Vec<String>,
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
            always_approve: false,
            power_profile: None,
            model_id: None,
            reasoning_effort: None,
            privacy_mode: "strict".into(),
            private_chat: false,
        };
        assert_eq!(
            key.key_string(),
            "/Users/me/proj::workspace::off::strict::ask::default::default::durable"
        );
        let with_model = ConnectionKey {
            model_id: Some("grok-4.5".into()),
            reasoning_effort: Some("high".into()),
            ..key
        };
        assert_eq!(
            with_model.key_string(),
            "/Users/me/proj::workspace::off::strict::ask::grok-4.5::high::durable"
        );
        let private = ConnectionKey {
            private_chat: true,
            ..with_model
        };
        assert_eq!(
            private.key_string(),
            "/Users/me/proj::workspace::off::strict::ask::grok-4.5::high::private"
        );
    }

    #[test]
    fn runtime_snapshot_roundtrip_camel_case() {
        let snap = RuntimeSnapshot {
            connections: vec![ConnectionSnapshot {
                connection_id: "c1".into(),
                key: ConnectionKey {
                    workspace_root: "/repo".into(),
                    sandbox: SandboxMode::None,
                    always_approve: true,
                    power_profile: Some(PowerProfile::Balanced),
                    model_id: Some("grok-build".into()),
                    reasoning_effort: None,
                    privacy_mode: "strict".into(),
                    private_chat: false,
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
            execution_root: None,
            base_commit: None,
            mode: TaskMode::Agent,
            permission_policy: PermissionPolicy::WorkspaceEdit,
            sandbox: SandboxMode::Workspace,
            archived: false,
            attention_required: false,
            applied_at: None,
            model: Some("grok-build".into()),
            reasoning_effort: None,
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
