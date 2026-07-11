//! Event bus abstraction so RuntimePool can run without a Tauri AppHandle in tests.

use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime as TauriRuntime};

#[async_trait::async_trait]
pub trait EventBus: Send + Sync + 'static {
    fn emit_value(&self, event: &str, payload: Value);

    async fn request_action(
        &self,
        _connection_id: &str,
        _action: crate::platform::ActionRequest,
        _decision: crate::platform::PolicyDecision,
    ) -> Result<bool, crate::acp::AcpError> {
        Ok(false)
    }

    fn validate_write_path(
        &self,
        _session_id: &str,
        _path: &str,
    ) -> Result<(), crate::acp::AcpError> {
        Ok(())
    }
}

pub type SharedEventBus = Arc<dyn EventBus>;

pub struct TauriEventBus<R: TauriRuntime> {
    app: AppHandle<R>,
}

impl<R: TauriRuntime> TauriEventBus<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl<R: TauriRuntime> EventBus for TauriEventBus<R> {
    fn emit_value(&self, event: &str, payload: Value) {
        let _ = self.app.emit(event, payload);
    }
}

#[derive(Default)]
pub struct NoopEventBus;

#[async_trait::async_trait]
impl EventBus for NoopEventBus {
    fn emit_value(&self, _event: &str, _payload: Value) {}
}

pub fn emit_json(bus: &SharedEventBus, event: &str, payload: impl Serialize) {
    match serde_json::to_value(payload) {
        Ok(v) => bus.emit_value(event, v),
        Err(e) => bus.emit_value(
            "acp:error",
            serde_json::json!({ "message": format!("emit serialize error: {e}") }),
        ),
    }
}
