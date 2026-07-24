//! Host event bus: bridge ACP/platform events to Unix-socket subscribers.

use crate::acp::EventBus;
use crate::contracts::SessionEventEnvelope;
use crate::db::Database;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
pub(super) struct HostNotification {
    pub(super) jsonrpc: &'static str,
    pub(super) method: &'static str,
    pub(super) params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) cursor: Option<i64>,
}

pub(super) struct HostEventBus {
    pub(super) db: Arc<Database>,
    pub(super) events: broadcast::Sender<HostNotification>,
    pub(super) pending_actions: Arc<parking_lot::Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
    pub(super) private_chat: bool,
}

#[async_trait::async_trait]
impl EventBus for HostEventBus {
    fn emit_value(&self, event_name: &str, payload: Value) {
        let mut cursor = None;
        if !self.private_chat {
            if let Ok(envelope) = serde_json::from_value::<SessionEventEnvelope>(payload.clone()) {
                if self.db.append_runtime_envelope(&envelope).unwrap_or(false) {
                    let dedupe_key = format!(
                        "runtime:{}:{}:{}:{}",
                        envelope.connection_id,
                        envelope.session_id.as_deref().unwrap_or_default(),
                        envelope.sequence,
                        envelope.kind
                    );
                    cursor = self
                        .db
                        .platform_event_rowid_by_dedupe_key(&dedupe_key)
                        .ok()
                        .flatten();
                }
                if envelope.kind == "policy_decision" {
                    persist_policy_audit(&self.db, &envelope.payload);
                }
                if envelope.kind == "permission" {
                    if let Some(session_id) = envelope.session_id.as_deref() {
                        let _ = self.db.persist_permission_request(
                            &envelope.connection_id,
                            session_id,
                            &envelope.payload,
                        );
                    }
                }
            }
        }
        let _ = self.events.send(HostNotification {
            jsonrpc: "2.0",
            method: "host.event",
            params: json!({ "eventName": event_name, "payload": payload }),
            cursor,
        });
    }

    async fn request_action(
        &self,
        connection_id: &str,
        action: crate::platform::ActionRequest,
        decision: crate::platform::PolicyDecision,
    ) -> Result<bool, crate::acp::AcpError> {
        if !self.private_chat
            && self
                .db
                .policy_rule_allows(&action)
                .map_err(|error| crate::acp::AcpError::Message(error.to_string()))?
        {
            return Ok(true);
        }
        let request_id = format!("platform:{}", action.request_id);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.pending_actions
            .lock()
            .insert(request_id.clone(), sender);
        let mut options = vec![
            json!({ "optionId": "platform:allow-once", "name": "Allow once", "kind": "allow_once" }),
            json!({ "optionId": "platform:deny", "name": "Deny", "kind": "reject_once" }),
        ];
        if !self.private_chat && !matches!(action.risk, crate::platform::RiskLevel::Critical) {
            options.insert(1, json!({ "optionId": "platform:allow-session", "name": "Allow for this task", "kind": "allow_always" }));
            options.insert(2, json!({ "optionId": "platform:allow-project", "name": "Allow for this project", "kind": "allow_always" }));
        }
        let raw = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session/request_permission",
            "params": {
                "description": decision.reason,
                "action": action,
                "requiresSecondConfirmation": decision.requires_second_confirmation,
                "options": options
            }
        });
        let envelope = SessionEventEnvelope {
            connection_id: connection_id.into(),
            session_id: Some(action.session_id.clone()),
            sequence: action.request_id.parse().unwrap_or_else(|_| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            }),
            timestamp: crate::acp::iso_now(),
            source: crate::contracts::EventSource::System,
            kind: "permission".into(),
            payload: raw,
        };
        self.emit_value(
            "acp:server_request",
            serde_json::to_value(envelope).map_err(crate::acp::AcpError::Json)?,
        );
        match tokio::time::timeout(std::time::Duration::from_secs(300), receiver).await {
            Ok(Ok(allowed)) => Ok(allowed),
            Ok(Err(_)) => Ok(false),
            Err(_) => {
                self.pending_actions.lock().remove(&request_id);
                Ok(false)
            }
        }
    }

    fn validate_write_path(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<(), crate::acp::AcpError> {
        if self.private_chat {
            return Ok(());
        }
        let task_id = self
            .db
            .local_session_id(session_id)
            .map_err(|error| crate::acp::AcpError::Message(error.to_string()))?
            .unwrap_or_else(|| session_id.to_string());
        let Some(task) = self
            .db
            .get_task(&task_id)
            .map_err(|error| crate::acp::AcpError::Message(error.to_string()))?
        else {
            return Ok(());
        };
        if task.allowed_paths.is_empty() {
            return Ok(());
        }
        // Prefer the session execution/worktree root so relative Allowed path
        // entries resolve the same way terminal/fs handlers do.
        let workspace = self
            .db
            .get_session(&task_id)
            .ok()
            .flatten()
            .map(|session| {
                session
                    .execution_root
                    .filter(|root| !root.trim().is_empty())
                    .or(Some(session.workspace_root))
                    .unwrap_or_else(|| ".".into())
            })
            .unwrap_or_else(|| ".".into());
        let workspace = std::path::PathBuf::from(workspace);
        if !crate::policy::path_matches_allowed(&workspace, path, &task.allowed_paths) {
            return Err(crate::acp::AcpError::Message(format!(
                "TASK_PATH_DENIED: {path} is outside the task allowed paths"
            )));
        }
        Ok(())
    }

    fn task_allowed_paths(&self, session_id: &str) -> Vec<String> {
        if self.private_chat {
            return Vec::new();
        }
        let task_id = self
            .db
            .local_session_id(session_id)
            .ok()
            .flatten()
            .unwrap_or_else(|| session_id.to_string());
        self.db
            .get_task(&task_id)
            .ok()
            .flatten()
            .map(|task| task.allowed_paths)
            .unwrap_or_default()
    }
}

fn persist_policy_audit(db: &Database, payload: &Value) {
    let action = payload.get("action").unwrap_or(&Value::Null);
    let decision = payload.get("decision").unwrap_or(&Value::Null);
    let mut summary = crate::secrets::redact_secrets(&payload.to_string());
    summary.truncate(8 * 1024);
    let _ = db.record_audit(&crate::platform::AuditRecordInput {
        workspace_id: action
            .get("workspaceId")
            .and_then(Value::as_str)
            .unwrap_or("unattributed")
            .into(),
        task_id: action.get("taskId").and_then(Value::as_str).map(Into::into),
        session_id: action
            .get("sessionId")
            .and_then(Value::as_str)
            .map(Into::into),
        actor: action
            .get("actor")
            .and_then(Value::as_str)
            .unwrap_or("runtime")
            .into(),
        action: action
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .into(),
        decision: decision
            .get("decision")
            .and_then(Value::as_str)
            .map(Into::into),
        reason: decision
            .get("reason")
            .and_then(Value::as_str)
            .map(Into::into),
        redacted_summary: summary,
        event_id: None,
    });
}
