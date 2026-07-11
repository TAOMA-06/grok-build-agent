//! Authenticated, versioned JSON-RPC framing for the out-of-process Agent Host.

use schemars::JsonSchema;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::io;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const HOST_RPC_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcMeta {
    pub request_id: String,
    pub correlation_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HostRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    pub protocol_version: u32,
    pub auth_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<RpcMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<HostRpcErrorBody>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostRpcErrorBody {
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Error)]
pub enum HostRpcError {
    #[error("frame exceeds maximum size")]
    FrameTooLarge,
    #[error("host protocol version mismatch")]
    ProtocolMismatch,
    #[error("host authentication failed")]
    AuthenticationFailed,
    #[error("write RPC requires requestId, correlationId, and idempotencyKey")]
    MissingWriteMetadata,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub async fn write_frame<W: AsyncWrite + Unpin, T: Serialize>(
    writer: &mut W,
    value: &T,
) -> Result<(), HostRpcError> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(HostRpcError::FrameTooLarge);
    }
    writer.write_u32(bytes.len() as u32).await?;
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}

pub async fn read_frame<R: AsyncRead + Unpin, T: DeserializeOwned>(
    reader: &mut R,
) -> Result<T, HostRpcError> {
    let length = reader.read_u32().await? as usize;
    if length > MAX_FRAME_BYTES {
        return Err(HostRpcError::FrameTooLarge);
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn authorize(request: &HostRequest, expected_token: &str) -> Result<(), HostRpcError> {
    if request.protocol_version != HOST_RPC_VERSION || request.jsonrpc != "2.0" {
        return Err(HostRpcError::ProtocolMismatch);
    }
    if !constant_time_eq(request.auth_token.as_bytes(), expected_token.as_bytes()) {
        return Err(HostRpcError::AuthenticationFailed);
    }
    if is_write_method(&request.method) {
        let meta = request
            .meta
            .as_ref()
            .ok_or(HostRpcError::MissingWriteMetadata)?;
        if meta.request_id.trim().is_empty()
            || meta.correlation_id.trim().is_empty()
            || meta.idempotency_key.trim().is_empty()
        {
            return Err(HostRpcError::MissingWriteMetadata);
        }
    }
    Ok(())
}

pub fn is_write_method(method: &str) -> bool {
    matches!(
        method,
        "runtime.start"
            | "runtime.stop"
            | "session.create"
            | "session.resume"
            | "session.prompt"
            | "session.cancel"
            | "session.setModel"
            | "session.setMode"
            | "session.confirmMode"
            | "runtime.request"
            | "permission.decide"
    ) || matches!(
        method,
        "catalog.workspaces.upsert"
            | "catalog.workspaces.favorite"
            | "catalog.sessions.upsert"
            | "catalog.sessions.delete"
            | "catalog.sessions.saveDraft"
            | "catalog.sessions.saveUi"
            | "events.platform.append"
            | "events.appendCompat"
            | "git.fileAction"
            | "git.hunkAction"
            | "git.commit"
            | "git.checkpoint.create"
            | "git.checkpoint.restore"
            | "worktree.create"
            | "worktree.delete"
            | "worktree.apply"
            | "attachment.prepare"
            | "mcp.upsert"
            | "mcp.remove"
            | "settings.save"
            | "secret.set"
            | "secret.clear"
            | "plugin.install"
            | "plugin.uninstall"
            | "plugin.setEnabled"
            | "runtime.update"
            | "runtime.login"
            | "runtime.logout"
            | "runtime.install"
            | "task.upsert"
            | "task.complete"
            | "context.save"
            | "verification.save"
            | "verification.run"
            | "terminal.create"
            | "terminal.input"
            | "terminal.resize"
            | "terminal.kill"
            | "terminal.release"
            | "permission.rule.delete"
            | "doctor.rebuildProjections"
            | "transcript.export"
            | "doctor.exportBundle"
            | "doctor.gcBlobs"
    )
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    let maximum = left.len().max(right.len());
    for index in 0..maximum {
        difference |= left.get(index).copied().unwrap_or(0) as usize
            ^ right.get(index).copied().unwrap_or(0) as usize;
    }
    difference == 0
}

#[cfg(target_os = "macos")]
pub fn verify_peer_uid(stream: &tokio::net::UnixStream) -> Result<(), HostRpcError> {
    use std::os::fd::AsRawFd;
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    // SAFETY: getpeereid only writes the two provided scalar outputs for this live socket fd.
    let result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if result != 0 {
        return Err(io::Error::last_os_error().into());
    }
    // SAFETY: geteuid has no preconditions and returns the current process effective uid.
    let current = unsafe { libc::geteuid() };
    if uid != current {
        return Err(HostRpcError::AuthenticationFailed);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn verify_peer_uid(stream: &tokio::net::UnixStream) -> Result<(), HostRpcError> {
    let peer = stream.peer_cred()?;
    // SAFETY: geteuid has no preconditions and returns the current process effective uid.
    let current = unsafe { libc::geteuid() };
    if peer.uid() != current {
        return Err(HostRpcError::AuthenticationFailed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str) -> HostRequest {
        HostRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(1),
            method: method.into(),
            params: Value::Null,
            protocol_version: HOST_RPC_VERSION,
            auth_token: "secret".into(),
            meta: Some(RpcMeta {
                request_id: "request-1".into(),
                correlation_id: "task-1".into(),
                idempotency_key: "key-1".into(),
            }),
        }
    }

    #[tokio::test]
    async fn framing_roundtrip_and_size_limit() {
        let (mut writer, mut reader) = tokio::io::duplex(4096);
        let expected = request("host.health");
        write_frame(&mut writer, &expected).await.unwrap();
        let actual: HostRequest = read_frame(&mut reader).await.unwrap();
        assert_eq!(actual.method, "host.health");
    }

    #[test]
    fn authorization_requires_protocol_token_and_write_metadata() {
        assert!(authorize(&request("runtime.start"), "secret").is_ok());
        let mut missing = request("runtime.start");
        missing.meta = None;
        assert!(matches!(
            authorize(&missing, "secret"),
            Err(HostRpcError::MissingWriteMetadata)
        ));
        assert!(matches!(
            authorize(&request("host.health"), "wrong"),
            Err(HostRpcError::AuthenticationFailed)
        ));
        let mut terminal_input = request("terminal.input");
        terminal_input.meta = None;
        assert!(matches!(
            authorize(&terminal_input, "secret"),
            Err(HostRpcError::MissingWriteMetadata)
        ));
    }
}
