//! Route ACP server→client requests: fs/terminal internal, permission to UI.

use super::events::{emit_json, SharedEventBus};
use super::fs_guard;
use super::terminal_host::{parse_create_params, TerminalHost};
use super::connection::ConnectionInner;
use super::AcpError;
use crate::contracts::{EventSource, SessionEventEnvelope};
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
        let result = handle_fs(&conn.cwd, &method, &params);
        respond(conn, id, result).await?;
        return Ok(());
    }

    if is_terminal_method(&method) {
        let result = handle_terminal(terminals, &conn.cwd, &method, &params).await;
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
            let limit = params.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);
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
            host.create(cwd, &cmd, &args, &env).await
        }
        "terminal/output" | "terminal/terminal_output" => {
            let id = terminal_id(params)?;
            host.output(&id)
        }
        "terminal/wait_for_exit" | "terminal/waitForExit" => {
            let id = terminal_id(params)?;
            host.wait_for_exit(&id).await
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
}
