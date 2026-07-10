mod acp;
mod config;
mod contracts;
mod db;
mod git_ops;
mod runtime;
mod secrets;

use acp::{AcpRuntime, AgentStatus, GrokProbe, StartConfig};
use config::AppSettings;
use contracts::{SessionSummary, SessionUiState};
use db::{CachedEvent, Database, GrokSessionHint};
use git_ops::{
    WorktreeCreateRequest, WorktreeDeleteRequest, WorktreeSummary,
};
use runtime::RuntimeHealth;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

struct AppState {
    runtime: Arc<AcpRuntime>,
    db: Arc<Database>,
}

#[tauri::command]
fn probe_grok(grok_path: Option<String>) -> GrokProbe {
    acp::probe_grok(grok_path.as_deref())
}

#[tauri::command]
fn runtime_health(grok_path: Option<String>) -> RuntimeHealth {
    runtime::health(grok_path.as_deref())
}

#[tauri::command]
fn load_settings() -> Result<AppSettings, config::ConfigError> {
    config::load_settings()
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), config::ConfigError> {
    config::save_settings(&settings)?;
    secrets::load_api_key_into_env();
    if !settings.api_key.is_empty() {
        secrets::apply_api_key_to_env(&settings.api_key);
    }
    Ok(())
}

#[tauri::command]
fn secret_status() -> secrets::SecretStatus {
    secrets::status()
}

#[tauri::command]
fn set_api_key(api_key: String) -> Result<(), secrets::SecretError> {
    secrets::set_api_key(&api_key)?;
    secrets::apply_api_key_to_env(&api_key);
    Ok(())
}

#[tauri::command]
fn clear_api_key() -> Result<(), secrets::SecretError> {
    secrets::delete_api_key()
}

#[tauri::command]
fn config_dir() -> Result<String, config::ConfigError> {
    config::config_dir_path()
}

#[tauri::command]
fn agent_status(state: State<'_, AppState>) -> AgentStatus {
    state.runtime.status()
}

#[tauri::command]
fn runtime_snapshot(state: State<'_, AppState>) -> crate::contracts::RuntimeSnapshot {
    state.runtime.snapshot()
}

#[tauri::command]
async fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: StartConfig,
) -> Result<AgentStatus, acp::AcpError> {
    secrets::load_api_key_into_env();
    if !config.cwd.trim().is_empty() {
        let _ = state.db.upsert_workspace(&config.cwd, None);
    }
    state.runtime.start(app, config).await
}

#[tauri::command]
async fn stop_agent(state: State<'_, AppState>) -> Result<(), acp::AcpError> {
    state.runtime.stop().await
}

#[tauri::command]
async fn restart_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: StartConfig,
) -> Result<AgentStatus, acp::AcpError> {
    state.runtime.stop().await?;
    secrets::load_api_key_into_env();
    state.runtime.start(app, config).await
}

#[tauri::command]
async fn send_prompt(
    state: State<'_, AppState>,
    text: String,
) -> Result<Value, acp::AcpError> {
    state.runtime.prompt(&text).await
}

#[tauri::command]
async fn acp_request(
    state: State<'_, AppState>,
    method: String,
    params: Value,
) -> Result<Value, acp::AcpError> {
    state.runtime.request(&method, params).await
}

#[tauri::command]
async fn respond_server_request(
    state: State<'_, AppState>,
    id: Value,
    result: Option<Value>,
    error: Option<Value>,
) -> Result<(), acp::AcpError> {
    state.runtime.respond_to_request(id, result, error).await
}

#[tauri::command]
fn harness_rules() -> String {
    acp::default_harness_rules()
}

#[tauri::command]
fn get_stderr_tail(state: State<'_, AppState>) -> AgentStatus {
    state.runtime.status()
}

// --- Persistence (T05) ----------------------------------------------------

#[tauri::command]
fn list_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<crate::contracts::WorkspaceRecord>, db::DbError> {
    state.db.list_workspaces()
}

#[tauri::command]
fn upsert_workspace(
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> Result<crate::contracts::WorkspaceRecord, db::DbError> {
    state.db.upsert_workspace(&path, name.as_deref())
}

#[tauri::command]
fn set_workspace_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> Result<(), db::DbError> {
    state.db.set_workspace_favorite(&id, favorite)
}

#[tauri::command]
fn list_sessions(
    state: State<'_, AppState>,
    workspace_root: Option<String>,
) -> Result<Vec<SessionSummary>, db::DbError> {
    state.db.list_sessions(workspace_root.as_deref())
}

#[tauri::command]
fn upsert_session(
    state: State<'_, AppState>,
    summary: SessionSummary,
) -> Result<(), db::DbError> {
    state.db.upsert_session(&summary)
}

#[tauri::command]
fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionSummary>, db::DbError> {
    state.db.get_session(&session_id)
}

#[tauri::command]
fn delete_session(state: State<'_, AppState>, session_id: String) -> Result<(), db::DbError> {
    state.db.delete_session(&session_id)
}

#[tauri::command]
fn save_draft(
    state: State<'_, AppState>,
    session_id: String,
    draft: String,
) -> Result<(), db::DbError> {
    state.db.save_draft(&session_id, &draft)
}

#[tauri::command]
fn save_session_ui(state: State<'_, AppState>, ui: SessionUiState) -> Result<(), db::DbError> {
    state.db.save_session_ui(&ui)
}

#[tauri::command]
fn load_session_ui(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionUiState>, db::DbError> {
    state.db.load_session_ui(&session_id)
}

#[tauri::command]
fn append_session_event(
    state: State<'_, AppState>,
    session_id: String,
    sequence: u64,
    timestamp: String,
    kind: String,
    payload: Value,
) -> Result<(), db::DbError> {
    state
        .db
        .append_event(&session_id, sequence, &timestamp, &kind, &payload)
}

#[tauri::command]
fn list_session_events(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<CachedEvent>, db::DbError> {
    state.db.list_events(&session_id)
}

#[tauri::command]
fn list_grok_sessions() -> Result<Vec<GrokSessionHint>, db::DbError> {
    db::list_grok_session_dirs()
}

#[tauri::command]
fn db_path(state: State<'_, AppState>) -> String {
    state.db.path().to_string_lossy().into()
}

// --- Git review (T09) -----------------------------------------------------

#[tauri::command]
fn git_review(workspace_root: String) -> Result<crate::contracts::ReviewSnapshot, git_ops::GitError> {
    git_ops::refresh_review(&workspace_root)
}

#[tauri::command]
fn git_file_patch(
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<String, git_ops::GitError> {
    git_ops::file_patch(&workspace_root, &path, staged, 256 * 1024)
}

// --- Worktrees (T10) ------------------------------------------------------

#[tauri::command]
fn list_worktrees(workspace_root: String) -> Result<Vec<WorktreeSummary>, git_ops::GitError> {
    git_ops::list_merged_worktrees(&workspace_root)
}

#[tauri::command]
fn create_worktree(req: WorktreeCreateRequest) -> Result<WorktreeSummary, git_ops::GitError> {
    git_ops::create_worktree(&req)
}

#[tauri::command]
fn delete_worktree(
    req: WorktreeDeleteRequest,
    main_workspace: String,
) -> Result<(), git_ops::GitError> {
    git_ops::delete_worktree(&req, &main_workspace)
}

#[tauri::command]
fn worktree_delete_preview(path: String) -> Result<Value, git_ops::GitError> {
    git_ops::worktree_delete_preview(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = Arc::new(AcpRuntime::new());
    let db = Arc::new(Database::open_default().expect("open local catalog database"));

    secrets::load_api_key_into_env();
    let _ = config::load_settings();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { runtime, db })
        .invoke_handler(tauri::generate_handler![
            probe_grok,
            runtime_health,
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
            acp_request,
            respond_server_request,
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
            git_review,
            git_file_patch,
            list_worktrees,
            create_worktree,
            delete_worktree,
            worktree_delete_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
