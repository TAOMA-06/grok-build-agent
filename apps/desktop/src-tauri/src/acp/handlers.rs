//! Route ACP server→client requests: fs/terminal internal, permission to UI.

use super::connection::ConnectionInner;
use super::events::{emit_json, SharedEventBus};
use super::fs_guard;
use super::terminal_host::{parse_create_params, TerminalHost};
use super::AcpError;
use crate::contracts::{EventSource, SessionEventEnvelope};
use crate::platform::PolicyDecisionKind;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn is_permission_method(method: &str) -> bool {
    method == "session/request_permission"
        || method == "session/requestPermission"
        || method.ends_with("/request_permission")
        || method.ends_with("/requestPermission")
        || method.contains("request_permission")
        || method.contains("requestPermission")
}

pub fn is_plan_approval_method(method: &str) -> bool {
    matches!(method, "_x.ai/exit_plan_mode" | "x.ai/exit_plan_mode")
}

pub fn is_fs_method(method: &str) -> bool {
    matches!(
        method,
        "fs/read_text_file"
            | "fs/write_text_file"
            | "fs/readTextFile"
            | "fs/writeTextFile"
            | "fs/read_text"
            | "fs/write_text"
    )
}

fn is_fs_write_method(method: &str) -> bool {
    matches!(
        method,
        "fs/write_text_file" | "fs/writeTextFile" | "fs/write_text"
    )
}

fn plan_blocks_fs_write(mode: &str, method: &str) -> bool {
    mode == "plan" && is_fs_write_method(method)
}

fn safe_plan_file_path(session_id: &str, params: &Value) -> Option<std::path::PathBuf> {
    let requested = std::path::PathBuf::from(params.get("path")?.as_str()?);
    if requested.file_name()?.to_str()? != "plan.md" || !requested.is_absolute() {
        return None;
    }
    if !requested.parent()?.file_name()?.to_str()?.eq(session_id) {
        return None;
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from)?;
    let sessions_root = std::fs::canonicalize(home.join(".grok").join("sessions")).ok()?;
    let parent = std::fs::canonicalize(requested.parent()?).ok()?;
    parent.starts_with(&sessions_root).then_some(requested)
}

fn handle_plan_file(
    method: &str,
    path: &std::path::Path,
    params: &Value,
) -> Result<Value, AcpError> {
    match method {
        "fs/read_text_file" | "fs/readTextFile" | "fs/read_text" => {
            let content = std::fs::read_to_string(path)
                .map_err(|error| AcpError::Message(format!("plan file read failed: {error}")))?;
            Ok(json!({ "content": content }))
        }
        "fs/write_text_file" | "fs/writeTextFile" | "fs/write_text" => {
            let content = params
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| AcpError::Message("plan file write missing content".into()))?;
            std::fs::write(path, content)
                .map_err(|error| AcpError::Message(format!("plan file write failed: {error}")))?;
            Ok(json!({}))
        }
        _ => Err(AcpError::Message(format!(
            "unknown plan file method {method}"
        ))),
    }
}

pub fn is_terminal_method(method: &str) -> bool {
    method.starts_with("terminal/")
}

/// Handle one server request. Returns true if fully handled (including emit-to-UI).
pub async fn handle_server_request(
    bus: &SharedEventBus,
    conn: &Arc<ConnectionInner>,
    terminals: &TerminalHost,
    msg: Value,
) -> Result<(), AcpError> {
    let method = msg
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let session_id = params
        .get("sessionId")
        .or_else(|| params.get("session_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| conn.active_session_id.lock().clone());

    if is_fs_method(&method) {
        if let Some(safe_plan_path) = session_id
            .as_deref()
            .and_then(|session_id| safe_plan_file_path(session_id, &params))
        {
            let result = handle_plan_file(&method, &safe_plan_path, &params);
            respond(conn, id, result).await?;
            return Ok(());
        }
        if session_id
            .as_deref()
            .map(|id| plan_blocks_fs_write(&conn.session_mode_state(id).current_mode, &method))
            .unwrap_or(false)
        {
            respond(
                conn,
                id,
                Err(AcpError::Message(
                    "PLAN_MODE_READ_ONLY: workspace writes are blocked until the plan is approved"
                        .into(),
                )),
            )
            .await?;
            return Ok(());
        }
        if is_fs_write_method(&method) {
            let Some(attributed_session) = session_id.as_deref() else {
                respond(
                    conn,
                    id,
                    Err(AcpError::Message(
                        "TASK_PATH_DENIED: filesystem write has no attributable session".into(),
                    )),
                )
                .await?;
                return Ok(());
            };
            let path = params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Err(error) = bus.validate_write_path(attributed_session, path) {
                respond(conn, id, Err(error)).await?;
                return Ok(());
            }
        }
        let result = handle_fs(&conn.cwd, &method, &params);
        respond(conn, id, result).await?;
        return Ok(());
    }

    if is_terminal_method(&method) {
        if matches!(
            method.as_str(),
            "terminal/create" | "terminal/create_terminal"
        ) {
            let Some(routed_session_id) = session_id.clone() else {
                respond(
                    conn,
                    id,
                    Err(AcpError::Message(
                        "POLICY_DENIED: terminal request has no attributable session".into(),
                    )),
                )
                .await?;
                return Ok(());
            };
            let (command, args) = parse_create_params(&params)?;
            let secret_refs = params
                .get("env")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.get("name").and_then(Value::as_str))
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let action = crate::policy::classify_terminal_action(
                json_rpc_id_string(&id),
                conn.cwd.to_string_lossy().into(),
                routed_session_id.clone(),
                routed_session_id.clone(),
                &command,
                &args,
                secret_refs,
            );
            let decision = crate::policy::evaluate(&action);
            if !matches!(decision.decision, PolicyDecisionKind::AllowOnce) {
                let allowed = bus
                    .request_action(&conn.connection_id, action, decision.clone())
                    .await?;
                if !allowed {
                    respond(
                        conn,
                        id,
                        Err(AcpError::Message(format!(
                            "POLICY_DENIED: {}",
                            decision.reason
                        ))),
                    )
                    .await?;
                    return Ok(());
                }
            }
        }
        let result = handle_terminal(
            terminals,
            &conn.cwd,
            session_id.as_deref(),
            &method,
            &params,
        )
        .await;
        respond(conn, id, result).await?;
        return Ok(());
    }

    if is_permission_method(&method) {
        // Only real permission requests reach the UI. Options come from the agent.
        let envelope = SessionEventEnvelope {
            connection_id: conn.connection_id.clone(),
            session_id,
            sequence: conn.next_sequence(),
            timestamp: super::connection::iso_now(),
            source: EventSource::Acp,
            kind: "permission".into(),
            payload: msg,
        };
        emit_json(bus, "acp:server_request", &envelope);
        return Ok(());
    }

    if is_plan_approval_method(&method) {
        let envelope = SessionEventEnvelope {
            connection_id: conn.connection_id.clone(),
            session_id,
            sequence: conn.next_sequence(),
            timestamp: super::connection::iso_now(),
            source: EventSource::Acp,
            kind: "plan_approval".into(),
            payload: msg,
        };
        emit_json(bus, "acp:server_request", &envelope);
        return Ok(());
    }

    // Unknown methods: never treat as permission. Surface as system notification.
    let envelope = SessionEventEnvelope {
        connection_id: conn.connection_id.clone(),
        session_id,
        sequence: conn.next_sequence(),
        timestamp: super::connection::iso_now(),
        source: EventSource::Acp,
        kind: "unknown_server_request".into(),
        payload: msg.clone(),
    };
    emit_json(bus, "acp:notification", &envelope);
    // Reject so the agent does not hang forever.
    respond(
        conn,
        id,
        Err(AcpError::Message(format!(
            "unsupported client method: {method}"
        ))),
    )
    .await?;
    Ok(())
}

fn json_rpc_id_string(id: &Value) -> String {
    id.as_str()
        .map(ToString::to_string)
        .or_else(|| id.as_i64().map(|value| value.to_string()))
        .or_else(|| id.as_u64().map(|value| value.to_string()))
        .unwrap_or_else(|| "unknown".into())
}

async fn respond(
    conn: &Arc<ConnectionInner>,
    id: Value,
    result: Result<Value, AcpError>,
) -> Result<(), AcpError> {
    match result {
        Ok(v) => conn.respond_to_request(id, Some(v), None).await,
        Err(e) => {
            conn.respond_to_request(
                id,
                None,
                Some(json!({
                    "code": -32000,
                    "message": e.to_string()
                })),
            )
            .await
        }
    }
}

fn handle_fs(cwd: &std::path::Path, method: &str, params: &Value) -> Result<Value, AcpError> {
    let path = params
        .get("path")
        .and_then(|p| p.as_str())
        .ok_or_else(|| AcpError::Message("fs request missing path".into()))?;

    match method {
        "fs/read_text_file" | "fs/readTextFile" | "fs/read_text" => {
            let limit = params
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);
            let content = fs_guard::read_text_file(cwd, path, limit)?;
            Ok(json!({ "content": content }))
        }
        "fs/write_text_file" | "fs/writeTextFile" | "fs/write_text" => {
            let content = params
                .get("content")
                .and_then(|c| c.as_str())
                .ok_or_else(|| AcpError::Message("fs write missing content".into()))?;
            fs_guard::write_text_file(cwd, path, content)?;
            Ok(json!({}))
        }
        _ => Err(AcpError::Message(format!("unknown fs method {method}"))),
    }
}

async fn handle_terminal(
    host: &TerminalHost,
    cwd: &std::path::Path,
    task_id: Option<&str>,
    method: &str,
    params: &Value,
) -> Result<Value, AcpError> {
    match method {
        "terminal/create" | "terminal/create_terminal" => {
            let (cmd, args) = parse_create_params(params)?;
            let env = params
                .get("env")
                .and_then(|e| e.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let name = item.get("name")?.as_str()?.to_string();
                            let value = item.get("value")?.as_str()?.to_string();
                            Some((name, value))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            host.create(cwd, task_id, &cmd, &args, &env).await
        }
        "terminal/output" | "terminal/terminal_output" => {
            let id = terminal_id(params)?;
            let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(256 * 1024) as usize;
            host.output_page(&id, offset, limit)
        }
        #[cfg(unix)]
        "terminal/input" | "terminal/write" | "terminal/write_input" => {
            let id = terminal_id(params)?;
            let data = params
                .get("data")
                .or_else(|| params.get("input"))
                .and_then(Value::as_str)
                .ok_or_else(|| AcpError::Message("terminal input missing data".into()))?;
            host.input(&id, data).await
        }
        #[cfg(unix)]
        "terminal/resize" => {
            let id = terminal_id(params)?;
            let columns = params
                .get("columns")
                .or_else(|| params.get("cols"))
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok())
                .ok_or_else(|| AcpError::Message("terminal resize missing columns".into()))?;
            let rows = params
                .get("rows")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok())
                .ok_or_else(|| AcpError::Message("terminal resize missing rows".into()))?;
            host.resize(&id, columns, rows)
        }
        "terminal/wait_for_exit" | "terminal/waitForExit" => {
            let id = terminal_id(params)?;
            host.wait_for_exit(&id).await
        }
        "terminal/ports" => {
            let id = terminal_id(params)?;
            host.ports(&id)
        }
        "terminal/kill" | "terminal/kill_command" | "terminal/killCommand" => {
            let id = terminal_id(params)?;
            host.kill(&id).await
        }
        "terminal/release" | "terminal/release_terminal" | "terminal/releaseTerminal" => {
            let id = terminal_id(params)?;
            host.release(&id).await
        }
        _ => Err(AcpError::Message(format!(
            "unknown terminal method {method}"
        ))),
    }
}

fn terminal_id(params: &Value) -> Result<String, AcpError> {
    params
        .get("terminalId")
        .or_else(|| params.get("terminal_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AcpError::Message("missing terminalId".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_vs_internal() {
        assert!(is_permission_method("session/request_permission"));
        assert!(!is_permission_method("fs/read_text_file"));
        assert!(is_fs_method("fs/readTextFile"));
        assert!(is_terminal_method("terminal/create"));
        assert!(!is_permission_method("x.ai/custom"));
    }

    #[test]
    fn plan_mode_blocks_workspace_writes_but_not_reads() {
        assert!(plan_blocks_fs_write("plan", "fs/write_text_file"));
        assert!(!plan_blocks_fs_write("plan", "fs/read_text_file"));
        assert!(!plan_blocks_fs_write("agent", "fs/write_text_file"));
    }

    #[test]
    fn recognizes_grok_plan_approval_reverse_request() {
        assert!(is_plan_approval_method("_x.ai/exit_plan_mode"));
        assert!(!is_plan_approval_method("_x.ai/session_notification"));
    }
}
