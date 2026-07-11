mod acp;
pub mod agent_host;
mod attachments;
pub mod blob_store;
mod cli_bridge;
mod config;
mod contracts;
mod db;
#[cfg(test)]
mod e2e_mock;
mod git_ops;
pub mod host_client;
pub mod host_rpc;
pub mod launch_agent;
pub mod platform;
pub mod policy;
mod runtime;
pub mod runtime_adapter;
mod secrets;
mod workspace_ops;

use acp::{AgentStatus, GrokProbe, StartConfig};
use config::AppSettings;
use contracts::{SessionSummary, SessionUiState};
use db::{CachedEvent, GrokSessionHint};
use git_ops::{
    WorktreeApplyPreview, WorktreeApplyRequest, WorktreeApplyResult, WorktreeCreateRequest,
    WorktreeDeleteRequest, WorktreeSummary,
};
use runtime::RuntimeHealth;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State};

struct AppState {
    host: Arc<host_client::HostClient>,
    host_subscription_started: AtomicBool,
}

fn rpc_meta(correlation_id: &str, idempotency_key: Option<String>) -> host_rpc::RpcMeta {
    let request_id = uuid::Uuid::new_v4().to_string();
    host_rpc::RpcMeta {
        request_id: request_id.clone(),
        correlation_id: correlation_id.to_string(),
        idempotency_key: idempotency_key.unwrap_or(request_id),
    }
}

async fn host_request<T: DeserializeOwned>(
    state: &AppState,
    method: &str,
    params: Value,
    meta: Option<host_rpc::RpcMeta>,
) -> Result<T, acp::AcpError> {
    let value = state
        .host
        .request(method, params, meta)
        .await
        .map_err(|error| acp::AcpError::Message(error.to_string()))?;
    serde_json::from_value(value).map_err(acp::AcpError::Json)
}

#[tauri::command]
async fn probe_grok(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<GrokProbe, acp::AcpError> {
    host_request(
        &state,
        "runtime.probe",
        serde_json::json!({ "grokPath": grok_path }),
        None,
    )
    .await
}

#[tauri::command]
async fn runtime_health(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<RuntimeHealth, acp::AcpError> {
    host_request(
        &state,
        "runtime.health",
        serde_json::json!({ "grokPath": grok_path }),
        None,
    )
    .await
}

#[tauri::command]
async fn ensure_agent_host(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    launch_agent::ensure_running().map_err(|error| error.to_string())?;
    if state
        .host_subscription_started
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        let host = state.host.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let event_app = app.clone();
                let _ = host
                    .subscribe(move |event_name, payload| {
                        let _ = event_app.emit(&event_name, payload);
                    })
                    .await;
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    }
    state.host.health().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn agent_host_health(state: State<'_, AppState>) -> Result<Value, String> {
    state.host.health().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn doctor_status(state: State<'_, AppState>) -> Result<Value, acp::AcpError> {
    host_request(&state, "doctor.status", Value::Null, None).await
}

#[tauri::command]
async fn rebuild_projections(
    state: State<'_, AppState>,
) -> Result<platform::ProjectionRebuildReport, acp::AcpError> {
    host_request(
        &state,
        "doctor.rebuildProjections",
        Value::Null,
        Some(rpc_meta("doctor-projections", None)),
    )
    .await
}

#[tauri::command]
async fn restart_agent_host() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(launch_agent::restart)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn diagnostic_bundle_preview(state: State<'_, AppState>) -> Result<String, acp::AcpError> {
    host_request(&state, "doctor.bundlePreview", Value::Null, None).await
}

#[tauri::command]
async fn export_diagnostic_bundle(
    state: State<'_, AppState>,
    destination: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "doctor.exportBundle",
        serde_json::json!({ "destination": destination }),
        Some(rpc_meta("doctor-bundle", None)),
    )
    .await
}

#[tauri::command]
async fn gc_blobs(state: State<'_, AppState>) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "doctor.gcBlobs",
        Value::Null,
        Some(rpc_meta("doctor-blob-gc", None)),
    )
    .await
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, acp::AcpError> {
    host_request(&state, "settings.load", Value::Null, None).await
}

#[tauri::command]
async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "settings.save",
        serde_json::json!({ "settings": settings }),
        Some(rpc_meta("settings", None)),
    )
    .await
}

#[tauri::command]
async fn secret_status(state: State<'_, AppState>) -> Result<secrets::SecretStatus, acp::AcpError> {
    host_request(&state, "secret.status", Value::Null, None).await
}

#[tauri::command]
async fn set_api_key(state: State<'_, AppState>, api_key: String) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "secret.set",
        serde_json::json!({ "apiKey": api_key }),
        Some(rpc_meta("secret", None)),
    )
    .await
}

#[tauri::command]
async fn clear_api_key(state: State<'_, AppState>) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "secret.clear",
        Value::Null,
        Some(rpc_meta("secret", None)),
    )
    .await
}

#[tauri::command]
fn config_dir() -> Result<String, config::ConfigError> {
    config::config_dir_path()
}

#[tauri::command]
async fn agent_status(state: State<'_, AppState>) -> Result<AgentStatus, acp::AcpError> {
    host_request(&state, "runtime.status", Value::Null, None).await
}

#[tauri::command]
async fn runtime_snapshot(
    state: State<'_, AppState>,
) -> Result<crate::contracts::RuntimeSnapshot, acp::AcpError> {
    host_request(&state, "runtime.snapshot", Value::Null, None).await
}

#[tauri::command]
async fn start_agent(
    state: State<'_, AppState>,
    config: StartConfig,
) -> Result<AgentStatus, acp::AcpError> {
    let correlation = config.resume_session_id.as_deref().unwrap_or(&config.cwd);
    host_request(
        &state,
        "runtime.start",
        serde_json::to_value(&config)?,
        Some(rpc_meta(correlation, None)),
    )
    .await
}

#[tauri::command]
async fn stop_agent(state: State<'_, AppState>) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "runtime.stop",
        Value::Null,
        Some(rpc_meta("runtime", None)),
    )
    .await
}

#[tauri::command]
async fn restart_agent(
    state: State<'_, AppState>,
    config: StartConfig,
) -> Result<AgentStatus, acp::AcpError> {
    stop_agent(state.clone()).await?;
    start_agent(state, config).await
}

#[tauri::command]
async fn send_prompt(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    text: Option<String>,
    content: Option<Vec<crate::contracts::PromptContent>>,
    dispatch: Option<crate::platform::PromptDispatchContext>,
) -> Result<Value, acp::AcpError> {
    let context = dispatch.unwrap_or_else(|| crate::platform::PromptDispatchContext {
        task_id: session_id.clone(),
        turn_id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: uuid::Uuid::new_v4().to_string(),
    });
    let blocks = content.unwrap_or_default();
    if !blocks.is_empty() {
        attachments::validate_prompt_content(&blocks)?;
    }
    host_request(
        &state,
        "session.prompt",
        serde_json::json!({
            "connectionId": connection_id,
            "sessionId": session_id,
            "taskId": context.task_id,
            "turnId": context.turn_id,
            "idempotencyKey": context.idempotency_key,
            "text": text.unwrap_or_default(),
            "content": blocks,
        }),
        Some(rpc_meta(
            &context.task_id,
            Some(context.idempotency_key.clone()),
        )),
    )
    .await
}

#[tauri::command]
fn platform_contract_schema() -> Value {
    platform::contract_schema_bundle()
}

#[tauri::command]
async fn append_platform_event(
    state: State<'_, AppState>,
    event: platform::PlatformEvent,
) -> Result<(), acp::AcpError> {
    let correlation = event.correlation_id.clone();
    host_request(
        &state,
        "events.platform.append",
        serde_json::json!({ "event": event }),
        Some(rpc_meta(&correlation, None)),
    )
    .await
}

#[tauri::command]
async fn list_platform_events(
    state: State<'_, AppState>,
    task_id: String,
    after_sequence: Option<u64>,
    limit: Option<usize>,
) -> Result<Vec<platform::PlatformEvent>, acp::AcpError> {
    host_request(
        &state,
        "events.platform.list",
        serde_json::json!({
            "taskId": task_id,
            "afterSequence": after_sequence,
            "limit": limit.unwrap_or(1_000),
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn inspect_attachments(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<crate::contracts::LocalAttachmentRef>, acp::AcpError> {
    host_request(
        &state,
        "attachment.inspect",
        serde_json::json!({ "paths": paths }),
        None,
    )
    .await
}

#[tauri::command]
async fn prepare_attachments(
    state: State<'_, AppState>,
    files: Vec<crate::contracts::LocalAttachmentRef>,
) -> Result<Vec<crate::contracts::PromptContent>, acp::AcpError> {
    host_request(
        &state,
        "attachment.prepare",
        serde_json::json!({ "files": files }),
        Some(rpc_meta("attachment", None)),
    )
    .await
}

#[tauri::command]
async fn list_models(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<Vec<crate::contracts::SelectableModel>, acp::AcpError> {
    host_request(
        &state,
        "runtime.models",
        serde_json::json!({ "grokPath": grok_path }),
        None,
    )
    .await
}

#[tauri::command]
async fn inspect_capabilities(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    workspace_root: Option<String>,
) -> Result<cli_bridge::CapabilitySnapshot, acp::AcpError> {
    host_request(
        &state,
        "runtime.capabilities",
        serde_json::json!({
            "grokPath": grok_path, "workspaceRoot": workspace_root
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn set_session_model(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    model_id: String,
) -> Result<crate::contracts::ModelSwitchResult, acp::AcpError> {
    host_request(
        &state,
        "session.setModel",
        serde_json::json!({
            "connectionId": connection_id,
            "sessionId": session_id,
            "modelId": model_id,
        }),
        Some(rpc_meta(&session_id, None)),
    )
    .await
}

#[tauri::command]
async fn set_session_mode(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    mode: String,
) -> Result<crate::contracts::ModeSwitchResult, acp::AcpError> {
    host_request(
        &state,
        "session.setMode",
        serde_json::json!({ "connectionId": connection_id, "sessionId": session_id, "mode": mode }),
        Some(rpc_meta(&session_id, None)),
    )
    .await
}

#[tauri::command]
async fn confirm_session_mode(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    mode: String,
) -> Result<crate::contracts::SessionModeState, acp::AcpError> {
    host_request(
        &state,
        "session.confirmMode",
        serde_json::json!({ "connectionId": connection_id, "sessionId": session_id, "mode": mode }),
        Some(rpc_meta(&session_id, None)),
    )
    .await
}

#[tauri::command]
async fn acp_request(
    state: State<'_, AppState>,
    method: String,
    params: Value,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "runtime.request",
        serde_json::json!({ "method": method, "params": params }),
        Some(rpc_meta("runtime", None)),
    )
    .await
}

#[tauri::command]
async fn respond_server_request(
    state: State<'_, AppState>,
    connection_id: String,
    id: Value,
    result: Option<Value>,
    error: Option<Value>,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "permission.decide",
        serde_json::json!({
            "connectionId": connection_id,
            "id": id,
            "result": result,
            "error": error,
        }),
        Some(rpc_meta("permission", None)),
    )
    .await
}

#[tauri::command]
async fn list_permission_requests(
    state: State<'_, AppState>,
    pending_only: Option<bool>,
) -> Result<Vec<db::StoredPermissionRequest>, acp::AcpError> {
    host_request(
        &state,
        "permission.list",
        serde_json::json!({ "pendingOnly": pending_only.unwrap_or(false) }),
        None,
    )
    .await
}

#[tauri::command]
async fn list_policy_rules(
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> Result<Vec<db::StoredPolicyRule>, acp::AcpError> {
    host_request(
        &state,
        "permission.rule.list",
        serde_json::json!({ "workspaceId": workspace_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn delete_policy_rule(
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "permission.rule.delete",
        serde_json::json!({ "ruleId": rule_id }),
        Some(rpc_meta("policy-rule", None)),
    )
    .await
}

#[tauri::command]
fn harness_rules() -> String {
    acp::default_harness_rules()
}

#[tauri::command]
async fn get_stderr_tail(state: State<'_, AppState>) -> Result<AgentStatus, acp::AcpError> {
    host_request(&state, "runtime.status", Value::Null, None).await
}

// --- Persistence (T05) ----------------------------------------------------

#[tauri::command]
async fn list_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<crate::contracts::WorkspaceRecord>, acp::AcpError> {
    host_request(&state, "catalog.workspaces.list", Value::Null, None).await
}

#[tauri::command]
async fn upsert_workspace(
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> Result<crate::contracts::WorkspaceRecord, acp::AcpError> {
    host_request(
        &state,
        "catalog.workspaces.upsert",
        serde_json::json!({ "path": path, "name": name }),
        Some(rpc_meta("workspace", None)),
    )
    .await
}

#[tauri::command]
async fn set_workspace_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "catalog.workspaces.favorite",
        serde_json::json!({ "id": id, "favorite": favorite }),
        Some(rpc_meta("workspace", None)),
    )
    .await
}

#[tauri::command]
async fn list_sessions(
    state: State<'_, AppState>,
    workspace_root: Option<String>,
) -> Result<Vec<SessionSummary>, acp::AcpError> {
    host_request(
        &state,
        "catalog.sessions.list",
        serde_json::json!({ "workspaceRoot": workspace_root }),
        None,
    )
    .await
}

#[tauri::command]
async fn upsert_session(
    state: State<'_, AppState>,
    summary: SessionSummary,
) -> Result<(), acp::AcpError> {
    let session_id = summary.session_id.clone();
    host_request(
        &state,
        "catalog.sessions.upsert",
        serde_json::json!({ "summary": summary }),
        Some(rpc_meta(&session_id, None)),
    )
    .await
}

#[tauri::command]
async fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionSummary>, acp::AcpError> {
    host_request(
        &state,
        "catalog.sessions.get",
        serde_json::json!({ "sessionId": session_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "catalog.sessions.delete",
        serde_json::json!({ "sessionId": session_id }),
        Some(rpc_meta("session", None)),
    )
    .await
}

#[tauri::command]
async fn save_draft(
    state: State<'_, AppState>,
    session_id: String,
    draft: String,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "catalog.sessions.saveDraft",
        serde_json::json!({ "sessionId": session_id, "draft": draft }),
        Some(rpc_meta("draft", None)),
    )
    .await
}

#[tauri::command]
async fn save_session_ui(
    state: State<'_, AppState>,
    ui: SessionUiState,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "catalog.sessions.saveUi",
        serde_json::json!({ "ui": ui }),
        Some(rpc_meta("session-ui", None)),
    )
    .await
}

#[tauri::command]
async fn load_session_ui(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionUiState>, acp::AcpError> {
    host_request(
        &state,
        "catalog.sessions.loadUi",
        serde_json::json!({ "sessionId": session_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn append_session_event(
    state: State<'_, AppState>,
    session_id: String,
    sequence: u64,
    timestamp: String,
    kind: String,
    payload: Value,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "events.appendCompat",
        serde_json::json!({
            "sessionId": session_id,
            "sequence": sequence,
            "timestamp": timestamp,
            "kind": kind,
            "payload": payload,
        }),
        Some(rpc_meta("event", None)),
    )
    .await
}

#[tauri::command]
async fn list_session_events(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<CachedEvent>, acp::AcpError> {
    host_request(
        &state,
        "events.list",
        serde_json::json!({ "sessionId": session_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn list_grok_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<GrokSessionHint>, acp::AcpError> {
    host_request(&state, "catalog.grokSessions.list", Value::Null, None).await
}

#[tauri::command]
async fn db_path(state: State<'_, AppState>) -> Result<String, acp::AcpError> {
    host_request(&state, "host.databasePath", Value::Null, None).await
}

#[tauri::command]
async fn workspace_tree(
    state: State<'_, AppState>,
    workspace_root: String,
    path: Option<String>,
) -> Result<Vec<workspace_ops::WorkspaceEntry>, acp::AcpError> {
    host_request(
        &state,
        "workspace.tree",
        serde_json::json!({
            "workspaceRoot": workspace_root, "path": path
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn workspace_search(
    state: State<'_, AppState>,
    workspace_root: String,
    query: String,
) -> Result<Vec<workspace_ops::WorkspaceEntry>, acp::AcpError> {
    host_request(
        &state,
        "workspace.search",
        serde_json::json!({
            "workspaceRoot": workspace_root, "query": query
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn workspace_read(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<workspace_ops::WorkspacePreview, acp::AcpError> {
    host_request(
        &state,
        "workspace.read",
        serde_json::json!({
            "workspaceRoot": workspace_root, "path": path
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn get_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<platform::TaskDefinition>, acp::AcpError> {
    host_request(
        &state,
        "task.get",
        serde_json::json!({ "taskId": task_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn upsert_task(
    state: State<'_, AppState>,
    task: platform::TaskDefinition,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "task.upsert",
        serde_json::json!({ "task": task }),
        Some(rpc_meta("task", None)),
    )
    .await
}

#[tauri::command]
async fn list_context_manifests(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<platform::ContextManifest>, acp::AcpError> {
    host_request(
        &state,
        "context.list",
        serde_json::json!({ "taskId": task_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn save_context_manifest(
    state: State<'_, AppState>,
    manifest: platform::ContextManifest,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "context.save",
        serde_json::json!({ "manifest": manifest }),
        Some(rpc_meta("context", None)),
    )
    .await
}

#[tauri::command]
async fn list_verification_results(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<platform::VerificationResult>, acp::AcpError> {
    host_request(
        &state,
        "verification.list",
        serde_json::json!({ "taskId": task_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn save_verification_result(
    state: State<'_, AppState>,
    result: platform::VerificationResult,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "verification.save",
        serde_json::json!({ "result": result }),
        Some(rpc_meta("verification", None)),
    )
    .await
}

#[tauri::command]
async fn run_verification(
    state: State<'_, AppState>,
    task_id: String,
    workspace_root: String,
    command: String,
) -> Result<platform::VerificationResult, acp::AcpError> {
    host_request(
        &state,
        "verification.run",
        serde_json::json!({
            "taskId": task_id,
            "workspaceRoot": workspace_root,
            "command": command,
        }),
        Some(rpc_meta("verification-run", None)),
    )
    .await
}

#[tauri::command]
async fn terminal_create(
    state: State<'_, AppState>,
    task_id: String,
    workspace_root: String,
    command: String,
    args: Vec<String>,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.create",
        serde_json::json!({
            "taskId": task_id,
            "workspaceRoot": workspace_root,
            "command": command,
            "args": args,
        }),
        Some(rpc_meta("terminal-create", None)),
    )
    .await
}

#[tauri::command]
async fn terminal_list(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.list",
        serde_json::json!({ "taskId": task_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn terminal_output(
    state: State<'_, AppState>,
    terminal_id: String,
    offset: usize,
    limit: usize,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.output",
        serde_json::json!({ "terminalId": terminal_id, "offset": offset, "limit": limit }),
        None,
    )
    .await
}

#[tauri::command]
async fn terminal_ports(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.ports",
        serde_json::json!({ "terminalId": terminal_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn terminal_input(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.input",
        serde_json::json!({ "terminalId": terminal_id, "data": data }),
        Some(rpc_meta("terminal-input", None)),
    )
    .await
}

#[tauri::command]
async fn terminal_resize(
    state: State<'_, AppState>,
    terminal_id: String,
    columns: u16,
    rows: u16,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.resize",
        serde_json::json!({ "terminalId": terminal_id, "columns": columns, "rows": rows }),
        Some(rpc_meta("terminal-resize", None)),
    )
    .await
}

#[tauri::command]
async fn terminal_kill(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.kill",
        serde_json::json!({ "terminalId": terminal_id }),
        Some(rpc_meta("terminal-kill", None)),
    )
    .await
}

#[tauri::command]
async fn terminal_release(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "terminal.release",
        serde_json::json!({ "terminalId": terminal_id }),
        Some(rpc_meta("terminal-release", None)),
    )
    .await
}

#[tauri::command]
async fn task_completion_gate(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<platform::CompletionGate, acp::AcpError> {
    host_request(
        &state,
        "task.completionGate",
        serde_json::json!({ "taskId": task_id }),
        None,
    )
    .await
}

#[tauri::command]
async fn complete_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<platform::CompletionGate, acp::AcpError> {
    host_request(
        &state,
        "task.complete",
        serde_json::json!({ "taskId": task_id }),
        Some(rpc_meta("task-complete", None)),
    )
    .await
}

#[tauri::command]
async fn export_transcript(
    state: State<'_, AppState>,
    session_id: String,
    format: String,
    destination: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "transcript.export",
        serde_json::json!({
            "sessionId": session_id,
            "format": format,
            "destination": destination,
        }),
        Some(rpc_meta("transcript-export", None)),
    )
    .await
}

// --- Git review (T09) -----------------------------------------------------

#[tauri::command]
async fn git_review(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::contracts::ReviewSnapshot, acp::AcpError> {
    host_request(
        &state,
        "git.review",
        serde_json::json!({ "workspaceRoot": workspace_root }),
        None,
    )
    .await
}

#[tauri::command]
async fn git_file_patch(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "git.filePatch",
        serde_json::json!({
            "workspaceRoot": workspace_root, "path": path, "staged": staged
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn git_file_action(
    state: State<'_, AppState>,
    req: git_ops::GitFileActionRequest,
) -> Result<git_ops::GitMutationResult, acp::AcpError> {
    host_request(
        &state,
        "git.fileAction",
        serde_json::json!({ "request": req }),
        Some(rpc_meta("git", None)),
    )
    .await
}

#[tauri::command]
async fn git_hunk_action(
    state: State<'_, AppState>,
    req: git_ops::GitHunkActionRequest,
) -> Result<git_ops::GitMutationResult, acp::AcpError> {
    host_request(
        &state,
        "git.hunkAction",
        serde_json::json!({ "request": req }),
        Some(rpc_meta("git", None)),
    )
    .await
}

#[tauri::command]
async fn git_commit(
    state: State<'_, AppState>,
    req: git_ops::GitCommitRequest,
) -> Result<git_ops::GitCommitResult, acp::AcpError> {
    host_request(
        &state,
        "git.commit",
        serde_json::json!({ "request": req }),
        Some(rpc_meta("git", None)),
    )
    .await
}

#[tauri::command]
async fn git_create_checkpoint(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<git_ops::GitCheckpoint, acp::AcpError> {
    host_request(
        &state,
        "git.checkpoint.create",
        serde_json::json!({ "workspaceRoot": workspace_root }),
        Some(rpc_meta("git", None)),
    )
    .await
}

#[tauri::command]
async fn git_checkpoint_restore_preview(
    state: State<'_, AppState>,
    workspace_root: String,
    checkpoint_id: String,
) -> Result<git_ops::GitCheckpointRestorePreview, acp::AcpError> {
    host_request(
        &state,
        "git.checkpoint.preview",
        serde_json::json!({
            "workspaceRoot": workspace_root, "checkpointId": checkpoint_id
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn git_restore_checkpoint(
    state: State<'_, AppState>,
    workspace_root: String,
    checkpoint_id: String,
) -> Result<git_ops::GitCheckpoint, acp::AcpError> {
    host_request(
        &state,
        "git.checkpoint.restore",
        serde_json::json!({
            "workspaceRoot": workspace_root, "checkpointId": checkpoint_id
        }),
        Some(rpc_meta("git-checkpoint", None)),
    )
    .await
}

// --- Worktrees (T10) ------------------------------------------------------

#[tauri::command]
async fn list_worktrees(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<WorktreeSummary>, acp::AcpError> {
    host_request(
        &state,
        "worktree.list",
        serde_json::json!({ "workspaceRoot": workspace_root }),
        None,
    )
    .await
}

#[tauri::command]
async fn create_worktree(
    state: State<'_, AppState>,
    req: WorktreeCreateRequest,
) -> Result<WorktreeSummary, acp::AcpError> {
    host_request(
        &state,
        "worktree.create",
        serde_json::json!({ "request": req }),
        Some(rpc_meta("worktree", None)),
    )
    .await
}

#[tauri::command]
async fn delete_worktree(
    state: State<'_, AppState>,
    req: WorktreeDeleteRequest,
    main_workspace: String,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "worktree.delete",
        serde_json::json!({ "request": req, "mainWorkspace": main_workspace }),
        Some(rpc_meta("worktree", None)),
    )
    .await
}

#[tauri::command]
async fn worktree_delete_preview(
    state: State<'_, AppState>,
    path: String,
) -> Result<Value, acp::AcpError> {
    host_request(
        &state,
        "worktree.deletePreview",
        serde_json::json!({ "path": path }),
        None,
    )
    .await
}

#[tauri::command]
async fn worktree_apply_preview(
    state: State<'_, AppState>,
    req: WorktreeApplyRequest,
) -> Result<WorktreeApplyPreview, acp::AcpError> {
    host_request(
        &state,
        "worktree.applyPreview",
        serde_json::json!({ "request": req }),
        None,
    )
    .await
}

#[tauri::command]
async fn apply_worktree_changes(
    state: State<'_, AppState>,
    req: WorktreeApplyRequest,
) -> Result<WorktreeApplyResult, acp::AcpError> {
    host_request(
        &state,
        "worktree.apply",
        serde_json::json!({ "request": req }),
        Some(rpc_meta("worktree", None)),
    )
    .await
}

// --- Plugins / MCP / install / update (T11–T12) ---------------------------

#[tauri::command]
async fn list_plugins(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<Vec<cli_bridge::PluginInfo>, acp::AcpError> {
    host_request(
        &state,
        "plugin.list",
        serde_json::json!({ "grokPath": grok_path }),
        None,
    )
    .await
}

#[tauri::command]
async fn install_plugin(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    source: String,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "plugin.install",
        serde_json::json!({ "grokPath": grok_path, "source": source }),
        Some(rpc_meta("plugin", None)),
    )
    .await
}

#[tauri::command]
async fn uninstall_plugin(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    name: String,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "plugin.uninstall",
        serde_json::json!({ "grokPath": grok_path, "name": name }),
        Some(rpc_meta("plugin", None)),
    )
    .await
}

#[tauri::command]
async fn set_plugin_enabled(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    name: String,
    enabled: bool,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "plugin.setEnabled",
        serde_json::json!({
            "grokPath": grok_path, "name": name, "enabled": enabled
        }),
        Some(rpc_meta("plugin", None)),
    )
    .await
}

#[tauri::command]
async fn validate_harness_plugin(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    path: String,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "plugin.validate",
        serde_json::json!({ "grokPath": grok_path, "path": path }),
        None,
    )
    .await
}

#[tauri::command]
async fn list_mcp_servers(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    workspace_root: Option<String>,
) -> Result<crate::contracts::McpListResult, acp::AcpError> {
    host_request(
        &state,
        "mcp.list",
        serde_json::json!({ "grokPath": grok_path, "workspaceRoot": workspace_root }),
        None,
    )
    .await
}

#[tauri::command]
async fn upsert_mcp_server(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    input: crate::contracts::McpServerInput,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "mcp.upsert",
        serde_json::json!({ "grokPath": grok_path, "input": input }),
        Some(rpc_meta("mcp", None)),
    )
    .await
}

#[tauri::command]
async fn remove_mcp_server(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    name: String,
    scope: Option<crate::contracts::McpScope>,
    workspace_root: Option<String>,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "mcp.remove",
        serde_json::json!({
            "grokPath": grok_path, "name": name, "scope": scope, "workspaceRoot": workspace_root
        }),
        Some(rpc_meta("mcp", None)),
    )
    .await
}

#[tauri::command]
async fn doctor_mcp_server(
    state: State<'_, AppState>,
    grok_path: Option<String>,
    name: Option<String>,
    workspace_root: Option<String>,
) -> Result<Vec<crate::contracts::McpDoctorResult>, acp::AcpError> {
    host_request(
        &state,
        "mcp.doctor",
        serde_json::json!({
            "grokPath": grok_path, "name": name, "workspaceRoot": workspace_root
        }),
        None,
    )
    .await
}

#[tauri::command]
async fn check_cli_update(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<cli_bridge::UpdateCheck, acp::AcpError> {
    host_request(
        &state,
        "runtime.updateCheck",
        serde_json::json!({ "grokPath": grok_path }),
        None,
    )
    .await
}

#[tauri::command]
async fn run_cli_update(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "runtime.update",
        serde_json::json!({ "grokPath": grok_path }),
        Some(rpc_meta("runtime-update", None)),
    )
    .await
}

#[tauri::command]
async fn run_cli_login(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "runtime.login",
        serde_json::json!({ "grokPath": grok_path }),
        Some(rpc_meta("runtime-login", None)),
    )
    .await
}

#[tauri::command]
async fn run_cli_logout(
    state: State<'_, AppState>,
    grok_path: Option<String>,
) -> Result<String, acp::AcpError> {
    host_request(
        &state,
        "runtime.logout",
        serde_json::json!({ "grokPath": grok_path }),
        Some(rpc_meta("runtime-logout", None)),
    )
    .await
}

#[tauri::command]
async fn install_cli_official(
    state: State<'_, AppState>,
) -> Result<Vec<cli_bridge::InstallProgress>, acp::AcpError> {
    host_request(
        &state,
        "runtime.install",
        Value::Null,
        Some(rpc_meta("runtime-install", None)),
    )
    .await
}

#[tauri::command]
fn official_install_url() -> String {
    cli_bridge::OFFICIAL_INSTALL_URL.to_string()
}

/// Cancel the exact prompt session. ACP defines this as a notification.
#[tauri::command]
async fn cancel_prompt(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
) -> Result<(), acp::AcpError> {
    host_request(
        &state,
        "session.cancel",
        serde_json::json!({ "connectionId": connection_id, "sessionId": session_id }),
        Some(rpc_meta(&session_id, None)),
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let host = Arc::new(
        host_client::HostClient::load_default().expect("load authenticated Agent Host client"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            host,
            host_subscription_started: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            probe_grok,
            runtime_health,
            ensure_agent_host,
            agent_host_health,
            doctor_status,
            rebuild_projections,
            restart_agent_host,
            diagnostic_bundle_preview,
            export_diagnostic_bundle,
            gc_blobs,
            load_settings,
            save_settings,
            secret_status,
            set_api_key,
            clear_api_key,
            config_dir,
            agent_status,
            runtime_snapshot,
            start_agent,
            stop_agent,
            restart_agent,
            send_prompt,
            platform_contract_schema,
            append_platform_event,
            list_platform_events,
            inspect_attachments,
            prepare_attachments,
            list_models,
            inspect_capabilities,
            set_session_model,
            set_session_mode,
            confirm_session_mode,
            acp_request,
            respond_server_request,
            list_permission_requests,
            list_policy_rules,
            delete_policy_rule,
            harness_rules,
            get_stderr_tail,
            list_workspaces,
            upsert_workspace,
            set_workspace_favorite,
            list_sessions,
            upsert_session,
            get_session,
            delete_session,
            save_draft,
            save_session_ui,
            load_session_ui,
            append_session_event,
            list_session_events,
            list_grok_sessions,
            db_path,
            workspace_tree,
            workspace_search,
            workspace_read,
            get_task,
            upsert_task,
            list_context_manifests,
            save_context_manifest,
            list_verification_results,
            save_verification_result,
            run_verification,
            terminal_create,
            terminal_list,
            terminal_output,
            terminal_ports,
            terminal_input,
            terminal_resize,
            terminal_kill,
            terminal_release,
            task_completion_gate,
            complete_task,
            export_transcript,
            git_review,
            git_file_patch,
            git_file_action,
            git_hunk_action,
            git_commit,
            git_create_checkpoint,
            git_checkpoint_restore_preview,
            git_restore_checkpoint,
            list_worktrees,
            create_worktree,
            delete_worktree,
            worktree_delete_preview,
            worktree_apply_preview,
            apply_worktree_changes,
            list_plugins,
            install_plugin,
            uninstall_plugin,
            set_plugin_enabled,
            validate_harness_plugin,
            list_mcp_servers,
            upsert_mcp_server,
            remove_mcp_server,
            doctor_mcp_server,
            check_cli_update,
            run_cli_update,
            run_cli_login,
            run_cli_logout,
            install_cli_official,
            official_install_url,
            cancel_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
