//! Production control-plane contracts shared by persistence, policy and runtime adapters.
//!
//! These types deliberately do not depend on Tauri. The independent Agent Host and the
//! desktop broker can therefore exchange the same versioned JSON-RPC payloads.

use async_trait::async_trait;
use schemars::{schema_for, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use thiserror::Error;

pub const HOST_PROTOCOL_VERSION: u32 = 1;
pub const EVENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Draft,
    Preparing,
    Running,
    AwaitingInput,
    AwaitingPermission,
    DeliveryUnknown,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefinition {
    pub task_id: String,
    pub workspace_id: String,
    pub state: TaskState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub acceptance: Vec<String>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub verification_commands: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Passed,
    Failed,
    NotRun,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub verification_id: String,
    pub task_id: String,
    pub turn_id: String,
    pub command: String,
    pub status: VerificationStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifestEntry {
    pub source: String,
    pub kind: String,
    pub trust: String,
    pub token_estimate: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated_reason: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifest {
    pub manifest_id: String,
    pub task_id: String,
    pub turn_id: String,
    pub token_budget: u64,
    pub entries: Vec<ContextManifestEntry>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompletionGate {
    pub ready: bool,
    pub blockers: Vec<String>,
    pub verification: Vec<VerificationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionRebuildReport {
    pub processed_events: u64,
    pub projected_entities: u64,
    pub last_rowid: i64,
    pub rebuilt_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlatformEvent {
    pub event_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub runtime_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub kind: String,
    pub schema_version: u32,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    pub correlation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedupe_key: Option<String>,
}

impl PlatformEvent {
    pub fn validate(&self) -> Result<(), PlatformContractError> {
        for (name, value) in [
            ("eventId", self.event_id.as_str()),
            ("workspaceId", self.workspace_id.as_str()),
            ("taskId", self.task_id.as_str()),
            ("sessionId", self.session_id.as_str()),
            ("runtimeId", self.runtime_id.as_str()),
            ("kind", self.kind.as_str()),
            ("timestamp", self.timestamp.as_str()),
            ("correlationId", self.correlation_id.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(PlatformContractError::Invalid(format!(
                    "{name} must not be empty"
                )));
            }
        }
        if self.schema_version == 0 {
            return Err(PlatformContractError::Invalid(
                "schemaVersion must be positive".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DispatchState {
    Prepared,
    Sending,
    Acknowledged,
    DeliveryUnknown,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptDispatch {
    pub dispatch_id: String,
    pub idempotency_key: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub runtime_id: String,
    pub state: DispatchState,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acknowledged_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
}

/// Controls how often the host re-sends the complete task contract to the runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FocusMode {
    Economy,
    Balanced,
}

impl Default for FocusMode {
    fn default() -> Self {
        Self::Balanced
    }
}

/// Local handling before prompt content crosses into the configured runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyMode {
    Strict,
    Standard,
}

impl Default for PrivacyMode {
    fn default() -> Self {
        Self::Strict
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptDispatchContext {
    pub task_id: String,
    pub turn_id: String,
    pub idempotency_key: String,
    #[serde(default)]
    pub focus_mode: FocusMode,
    #[serde(default)]
    pub privacy_mode: PrivacyMode,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActionEffect {
    Read,
    Write,
    Execute,
    Network,
    ExternalSideEffect,
    Destructive,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub request_id: String,
    pub actor: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub tool: String,
    pub effect: ActionEffect,
    #[serde(default)]
    pub argv: Vec<String>,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub network_targets: Vec<String>,
    #[serde(default)]
    pub secret_refs: Vec<String>,
    pub risk: RiskLevel,
    pub deadline: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecisionKind {
    AllowOnce,
    AllowSession,
    AllowProject,
    Deny,
    RequireConfirmation,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub request_id: String,
    pub decision: PolicyDecisionKind,
    pub decided_at: String,
    pub reason: String,
    #[serde(default)]
    pub matched_rule_ids: Vec<String>,
    #[serde(default)]
    pub requires_second_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecordInput {
    pub workspace_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub actor: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub redacted_summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLaunchConfig {
    pub executable: String,
    pub workspace_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub sandbox: String,
    #[serde(default)]
    pub privacy_mode: PrivacyMode,
    #[serde(default)]
    pub approval_policy: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstance {
    pub runtime_id: String,
    pub adapter_id: String,
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilitySet {
    pub protocol_version: String,
    pub runtime_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(default)]
    pub resume_session: bool,
    #[serde(default)]
    pub prompt_idempotency: bool,
    #[serde(default)]
    pub filesystem: bool,
    #[serde(default)]
    pub terminal: bool,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDoctorReport {
    pub healthy: bool,
    pub checked_at: String,
    #[serde(default)]
    pub findings: Vec<String>,
}

#[derive(Debug, Error)]
pub enum PlatformContractError {
    #[error("{0}")]
    Invalid(String),
    #[error("runtime adapter error: {0}")]
    Adapter(String),
}

#[async_trait]
pub trait RuntimeAdapter: Send + Sync {
    fn adapter_id(&self) -> &'static str;
    async fn probe(&self) -> Result<RuntimeCapabilitySet, PlatformContractError>;
    async fn authenticate(&self) -> Result<(), PlatformContractError>;
    async fn spawn(
        &self,
        config: RuntimeLaunchConfig,
    ) -> Result<RuntimeInstance, PlatformContractError>;
    async fn initialize(
        &self,
        instance: &RuntimeInstance,
    ) -> Result<RuntimeCapabilitySet, PlatformContractError>;
    async fn create_session(
        &self,
        instance: &RuntimeInstance,
    ) -> Result<String, PlatformContractError>;
    async fn resume_session(
        &self,
        instance: &RuntimeInstance,
        session_id: &str,
    ) -> Result<(), PlatformContractError>;
    async fn prompt(
        &self,
        instance: &RuntimeInstance,
        session_id: &str,
        prompt: &str,
        idempotency_key: &str,
    ) -> Result<Value, PlatformContractError>;
    async fn cancel(
        &self,
        instance: &RuntimeInstance,
        session_id: &str,
    ) -> Result<(), PlatformContractError>;
    async fn shutdown(&self, instance: &RuntimeInstance) -> Result<(), PlatformContractError>;
    async fn doctor(&self) -> Result<AdapterDoctorReport, PlatformContractError>;
    fn normalize_event(&self, raw: Value) -> Result<Value, PlatformContractError>;
}

pub fn contract_schema_bundle() -> Value {
    serde_json::json!({
        "protocolVersion": HOST_PROTOCOL_VERSION,
        "platformEvent": schema_for!(PlatformEvent),
        "promptDispatch": schema_for!(PromptDispatch),
        "actionRequest": schema_for!(ActionRequest),
        "policyDecision": schema_for!(PolicyDecision),
        "runtimeLaunchConfig": schema_for!(RuntimeLaunchConfig),
        "runtimeInstance": schema_for!(RuntimeInstance),
        "runtimeCapabilities": schema_for!(RuntimeCapabilitySet),
        "taskDefinition": schema_for!(TaskDefinition),
        "verificationResult": schema_for!(VerificationResult),
        "contextManifest": schema_for!(ContextManifest),
        "completionGate": schema_for!(CompletionGate),
        "projectionRebuildReport": schema_for!(ProjectionRebuildReport),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_event_rejects_missing_attribution() {
        let event = PlatformEvent {
            event_id: "e1".into(),
            workspace_id: "".into(),
            task_id: "t1".into(),
            session_id: "s1".into(),
            turn_id: None,
            runtime_id: "r1".into(),
            sequence: 1,
            timestamp: "2026-01-01T00:00:00Z".into(),
            kind: "turn.started".into(),
            schema_version: EVENT_SCHEMA_VERSION,
            payload: serde_json::json!({}),
            causation_id: None,
            correlation_id: "c1".into(),
            dedupe_key: None,
        };
        assert!(event.validate().is_err());
    }

    #[test]
    fn schema_bundle_is_versioned() {
        let schema = contract_schema_bundle();
        assert_eq!(schema["protocolVersion"], HOST_PROTOCOL_VERSION);
        assert!(schema["platformEvent"].is_object());
    }

    #[test]
    fn typescript_contract_mirror_contains_canonical_wire_values() {
        let typescript = include_str!("../../src/contracts/platform.ts");
        assert!(typescript.contains(&format!(
            "HOST_PROTOCOL_VERSION = {} as const",
            HOST_PROTOCOL_VERSION
        )));
        for value in [
            "draft",
            "preparing",
            "running",
            "awaiting_input",
            "awaiting_permission",
            "delivery_unknown",
            "verifying",
            "completed",
            "failed",
            "cancelled",
        ] {
            assert!(
                typescript.contains(&format!("\"{value}\"")),
                "TypeScript mirror is missing {value}"
            );
        }
        for field in [
            "eventId",
            "workspaceId",
            "taskId",
            "sessionId",
            "runtimeId",
            "schemaVersion",
            "correlationId",
            "idempotencyKey",
        ] {
            assert!(
                typescript.contains(&format!("{field}:")),
                "TypeScript mirror is missing {field}"
            );
        }
    }
}
