mod acp;
mod config;
mod contracts;
mod runtime;

use acp::{AcpRuntime, AgentStatus, GrokProbe, StartConfig};
use config::AppSettings;
use runtime::RuntimeHealth;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

struct AppState {
    runtime: Arc<AcpRuntime>,
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
    // Keep process env in sync for subsequent agent spawns.
    runtime::apply_api_key_to_env(&settings.api_key);
    config::save_settings(&settings)
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
async fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: StartConfig,
) -> Result<AgentStatus, acp::AcpError> {
    // Ensure settings API key is applied before spawn.
    if let Ok(s) = config::load_settings() {
        runtime::apply_api_key_to_env(&s.api_key);
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
    if let Ok(s) = config::load_settings() {
        runtime::apply_api_key_to_env(&s.api_key);
    }
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
    // Status already carries last_error; frontend keeps stderr via events.
    state.runtime.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = Arc::new(AcpRuntime::new());

    // Seed env from saved settings on boot.
    if let Ok(s) = config::load_settings() {
        runtime::apply_api_key_to_env(&s.api_key);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { runtime })
        .invoke_handler(tauri::generate_handler![
            probe_grok,
            runtime_health,
            load_settings,
            save_settings,
            config_dir,
            agent_status,
            start_agent,
            stop_agent,
            restart_agent,
            send_prompt,
            acp_request,
            respond_server_request,
            harness_rules,
            get_stderr_tail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
