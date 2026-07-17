//! Thin authenticated client used by the Tauri UI broker.

use crate::host_rpc::{self, HostRequest, HostResponse, RpcMeta};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::net::UnixStream;

#[derive(Debug, Error)]
pub enum HostClientError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Rpc(#[from] crate::host_rpc::HostRpcError),
}

#[derive(Clone)]
pub struct HostClient {
    socket: PathBuf,
    token: Arc<String>,
    next_id: Arc<AtomicU64>,
    subscription_guard: Arc<tokio::sync::Mutex<()>>,
    event_cursor: Arc<AtomicI64>,
}

impl HostClient {
    pub fn load_default() -> Result<Self, HostClientError> {
        Ok(Self {
            socket: crate::agent_host::socket_path()
                .map_err(|error| HostClientError::Message(error.to_string()))?,
            token: Arc::new(
                crate::secrets::get_or_create_host_ipc_token()
                    .map_err(|error| HostClientError::Message(error.to_string()))?,
            ),
            next_id: Arc::new(AtomicU64::new(1)),
            subscription_guard: Arc::new(tokio::sync::Mutex::new(())),
            event_cursor: Arc::new(AtomicI64::new(0)),
        })
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        meta: Option<RpcMeta>,
    ) -> Result<Value, HostClientError> {
        let mut stream = UnixStream::connect(&self.socket)
            .await
            .map_err(|error| HostClientError::Message(format!("connect Agent Host: {error}")))?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        host_rpc::write_frame(
            &mut stream,
            &HostRequest {
                jsonrpc: "2.0".into(),
                id: json!(id),
                method: method.into(),
                params,
                protocol_version: host_rpc::HOST_RPC_VERSION,
                auth_token: (*self.token).clone(),
                meta,
            },
        )
        .await?;
        let response: HostResponse = host_rpc::read_frame(&mut stream).await?;
        if let Some(error) = response.error {
            return Err(HostClientError::Message(error.message));
        }
        Ok(response.result.unwrap_or(Value::Null))
    }

    pub async fn health(&self) -> Result<Value, HostClientError> {
        self.request("host.health", Value::Null, None).await
    }

    pub fn token_fingerprint(&self) -> String {
        use sha2::Digest;
        hex::encode(sha2::Sha256::digest(self.token.as_bytes()))
    }

    pub async fn subscribe<F>(&self, mut on_event: F) -> Result<(), HostClientError>
    where
        F: FnMut(String, Value) -> Result<(), String> + Send,
    {
        let _subscription = self.subscription_guard.lock().await;
        let mut stream = UnixStream::connect(&self.socket)
            .await
            .map_err(|error| HostClientError::Message(format!("connect Agent Host: {error}")))?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        host_rpc::write_frame(
            &mut stream,
            &HostRequest {
                jsonrpc: "2.0".into(),
                id: json!(id),
                method: "events.subscribe".into(),
                params: json!({
                    "afterRowid": self.event_cursor.load(Ordering::Acquire)
                }),
                protocol_version: host_rpc::HOST_RPC_VERSION,
                auth_token: (*self.token).clone(),
                meta: None,
            },
        )
        .await?;
        let _: HostResponse = host_rpc::read_frame(&mut stream).await?;
        loop {
            let notification: Value = match host_rpc::read_frame(&mut stream).await {
                Ok(value) => value,
                Err(error) => return Err(error.into()),
            };
            let Some(params) = notification.get("params") else {
                continue;
            };
            let cursor = notification.get("cursor").and_then(Value::as_i64);
            if let Some(cursor) = cursor {
                if cursor <= self.event_cursor.load(Ordering::Acquire) {
                    continue;
                }
            }
            let Some(name) = params.get("eventName").and_then(Value::as_str) else {
                continue;
            };
            on_event(
                name.to_string(),
                params.get("payload").cloned().unwrap_or(Value::Null),
            )
            .map_err(HostClientError::Message)?;
            // A renderer retry is safer than advancing the durable cursor before
            // Tauri has accepted the event for delivery.
            if let Some(cursor) = cursor {
                self.event_cursor.fetch_max(cursor, Ordering::AcqRel);
            }
        }
    }
}
