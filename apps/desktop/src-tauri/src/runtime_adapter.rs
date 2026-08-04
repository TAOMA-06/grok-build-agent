//! Grok ACP implementation of the runtime-neutral adapter contract.

use crate::acp::{AcpRuntime, SharedEventBus, StartConfig};
use crate::contracts::SandboxMode;
use crate::platform::{
    AdapterDoctorReport, PlatformContractError, RuntimeAdapter, RuntimeCapabilitySet,
    RuntimeInstance, RuntimeLaunchConfig,
};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub struct GrokAcpAdapter {
    adapter_id: &'static str,
    runtime: Arc<AcpRuntime>,
    bus: SharedEventBus,
    launches: Mutex<HashMap<String, RuntimeLaunchConfig>>,
}

impl GrokAcpAdapter {
    pub fn new(runtime: Arc<AcpRuntime>, bus: SharedEventBus) -> Self {
        Self::with_id(crate::adapter_registry::GROK_ADAPTER_ID, runtime, bus)
    }

    /// Second ACP-compatible channel (W1-A). Same protocol shape; distinct adapter id.
    pub fn generic(runtime: Arc<AcpRuntime>, bus: SharedEventBus) -> Self {
        Self::with_id(crate::adapter_registry::GENERIC_ADAPTER_ID, runtime, bus)
    }

    fn with_id(
        adapter_id: &'static str,
        runtime: Arc<AcpRuntime>,
        bus: SharedEventBus,
    ) -> Self {
        Self {
            adapter_id,
            runtime,
            bus,
            launches: Mutex::new(HashMap::new()),
        }
    }

    fn start_config(config: &RuntimeLaunchConfig, resume: Option<String>) -> StartConfig {
        StartConfig {
            task_id: Some(format!("adapter:{}", config.workspace_root)),
            grok_path: (!config.executable.trim().is_empty()).then(|| config.executable.clone()),
            model: config.model.clone(),
            reasoning_effort: None,
            always_approve: config.approval_policy == "full_auto",
            strict_terminal: false,
            cwd: config.workspace_root.clone(),
            rules: config.rules.clone(),
            agent_profile: config.agent_profile.clone(),
            use_harness: false,
            sandbox: Some(match config.sandbox.as_str() {
                "none" => SandboxMode::None,
                "strict" => SandboxMode::Strict,
                _ => SandboxMode::Workspace,
            }),
            privacy_mode: config.privacy_mode,
            power_profile: None,
            resume_session_id: resume,
            private_chat: false,
            disallowed_tools: Vec::new(),
        }
    }

    fn capabilities_from_snapshot(
        &self,
        instance: Option<&RuntimeInstance>,
    ) -> RuntimeCapabilitySet {
        let snapshot = self.runtime.snapshot();
        let connection = instance.and_then(|instance| {
            snapshot
                .connections
                .iter()
                .find(|item| item.connection_id == instance.connection_id)
        });
        let caps = connection.and_then(|item| item.capabilities.as_ref());
        RuntimeCapabilitySet {
            protocol_version: caps
                .and_then(|caps| caps.protocol_version.as_ref())
                .map(ToString::to_string)
                .unwrap_or_else(|| "1".into()),
            runtime_name: caps
                .and_then(|caps| caps.agent_name.clone())
                .unwrap_or_else(|| "Grok Build".into()),
            runtime_version: caps.and_then(|caps| caps.agent_version.clone()),
            resume_session: caps.map(|caps| caps.load_session).unwrap_or(false),
            // ACP currently has no prompt idempotency capability. The platform dispatch
            // journal therefore owns duplicate suppression and uncertain-delivery state.
            prompt_idempotency: false,
            filesystem: caps.map(|caps| caps.fs).unwrap_or(false),
            terminal: caps.map(|caps| caps.terminal).unwrap_or(false),
            models: caps.map(|caps| caps.models.clone()).unwrap_or_default(),
        }
    }
}

#[async_trait]
impl RuntimeAdapter for GrokAcpAdapter {
    fn adapter_id(&self) -> &'static str {
        self.adapter_id
    }

    async fn probe(&self) -> Result<RuntimeCapabilitySet, PlatformContractError> {
        if self.adapter_id == crate::adapter_registry::GENERIC_ADAPTER_ID
            && crate::adapter_registry::secondary_acp_path().is_none()
        {
            return Err(PlatformContractError::Adapter(format!(
                "{} is not configured; set {} to an ACP executable",
                crate::adapter_registry::GENERIC_ADAPTER_ID,
                crate::adapter_registry::SECONDARY_ACP_ENV
            )));
        }
        Ok(self.capabilities_from_snapshot(None))
    }

    async fn authenticate(&self) -> Result<(), PlatformContractError> {
        // Authentication is negotiated during ACP initialize and never accepts chat text.
        Ok(())
    }

    async fn spawn(
        &self,
        mut config: RuntimeLaunchConfig,
    ) -> Result<RuntimeInstance, PlatformContractError> {
        if self.adapter_id == crate::adapter_registry::GENERIC_ADAPTER_ID {
            let secondary = crate::adapter_registry::secondary_acp_path().ok_or_else(|| {
                PlatformContractError::Adapter(format!(
                    "{} is not configured; set {} to an ACP executable",
                    crate::adapter_registry::GENERIC_ADAPTER_ID,
                    crate::adapter_registry::SECONDARY_ACP_ENV
                ))
            })?;
            if config.executable.trim().is_empty() {
                config.executable = secondary;
            }
        }
        let status = self
            .runtime
            .start_with_bus(self.bus.clone(), Self::start_config(&config, None))
            .await
            .map_err(|error| PlatformContractError::Adapter(error.to_string()))?;
        let connection_id = status.connection_id.ok_or_else(|| {
            PlatformContractError::Adapter("Grok start did not return connectionId".into())
        })?;
        self.launches.lock().insert(connection_id.clone(), config);
        let pid = self
            .runtime
            .snapshot()
            .connections
            .iter()
            .find(|item| item.connection_id == connection_id)
            .and_then(|item| item.pid);
        Ok(RuntimeInstance {
            runtime_id: connection_id.clone(),
            adapter_id: self.adapter_id().into(),
            connection_id,
            session_id: status.session_id,
            pid,
        })
    }

    async fn initialize(
        &self,
        instance: &RuntimeInstance,
    ) -> Result<RuntimeCapabilitySet, PlatformContractError> {
        Ok(self.capabilities_from_snapshot(Some(instance)))
    }

    async fn create_session(
        &self,
        instance: &RuntimeInstance,
    ) -> Result<String, PlatformContractError> {
        let config = self
            .launches
            .lock()
            .get(&instance.connection_id)
            .cloned()
            .ok_or_else(|| PlatformContractError::Adapter("runtime launch not found".into()))?;
        self.runtime
            .new_session(
                &instance.connection_id,
                &config.workspace_root,
                config.rules,
                false,
                config.agent_profile,
            )
            .await
            .map_err(|error| PlatformContractError::Adapter(error.to_string()))
    }

    async fn resume_session(
        &self,
        instance: &RuntimeInstance,
        session_id: &str,
    ) -> Result<(), PlatformContractError> {
        let config = self
            .launches
            .lock()
            .get(&instance.connection_id)
            .cloned()
            .ok_or_else(|| PlatformContractError::Adapter("runtime launch not found".into()))?;
        self.runtime
            .start_with_bus(
                self.bus.clone(),
                Self::start_config(&config, Some(session_id.to_string())),
            )
            .await
            .map(|_| ())
            .map_err(|error| PlatformContractError::Adapter(error.to_string()))
    }

    async fn prompt(
        &self,
        instance: &RuntimeInstance,
        session_id: &str,
        prompt: &str,
        _idempotency_key: &str,
    ) -> Result<Value, PlatformContractError> {
        self.runtime
            .prompt_session(&instance.connection_id, session_id, prompt)
            .await
            .map_err(|error| PlatformContractError::Adapter(error.to_string()))
    }

    async fn cancel(
        &self,
        instance: &RuntimeInstance,
        session_id: &str,
    ) -> Result<(), PlatformContractError> {
        self.runtime
            .cancel_session(&instance.connection_id, session_id)
            .map_err(|error| PlatformContractError::Adapter(error.to_string()))
    }

    async fn shutdown(&self, instance: &RuntimeInstance) -> Result<(), PlatformContractError> {
        self.runtime
            .stop_connection(&instance.connection_id)
            .await
            .map_err(|error| PlatformContractError::Adapter(error.to_string()))
    }

    async fn doctor(&self) -> Result<AdapterDoctorReport, PlatformContractError> {
        let snapshot = self.runtime.snapshot();
        let findings = snapshot
            .connections
            .iter()
            .filter_map(|connection| connection.last_error.clone())
            .map(|finding| crate::secrets::redact_secrets(&finding))
            .collect::<Vec<_>>();
        Ok(AdapterDoctorReport {
            healthy: findings.is_empty(),
            checked_at: crate::acp::iso_now(),
            findings,
        })
    }

    fn normalize_event(&self, raw: Value) -> Result<Value, PlatformContractError> {
        if !raw.is_object() {
            return Err(PlatformContractError::Invalid(
                "runtime event must be a JSON object".into(),
            ));
        }
        Ok(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::NoopEventBus;
    use crate::platform::RuntimeAdapter;
    use uuid::Uuid;

    #[tokio::test]
    async fn grok_adapter_conformance_spawn_prompt_cancel_shutdown() {
        let workspace = std::env::temp_dir().join(format!("gbd-adapter-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&workspace).unwrap();
        let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/mock_acp_agent.py");
        let adapter = GrokAcpAdapter::new(Arc::new(AcpRuntime::new()), Arc::new(NoopEventBus));
        let instance = adapter
            .spawn(RuntimeLaunchConfig {
                executable: executable.to_string_lossy().into(),
                workspace_root: workspace.to_string_lossy().into(),
                model: None,
                sandbox: "workspace".into(),
                privacy_mode: crate::platform::PrivacyMode::Strict,
                approval_policy: "workspace_edit".into(),
                rules: None,
                agent_profile: None,
            })
            .await
            .unwrap();
        let session = instance.session_id.clone().unwrap();
        let caps = adapter.initialize(&instance).await.unwrap();
        assert_eq!(caps.runtime_name, "mock-acp-agent");
        let response = adapter
            .prompt(&instance, &session, "hello", "dispatch-1")
            .await
            .unwrap();
        assert_eq!(response["echoSessionId"], session);
        adapter.cancel(&instance, &session).await.unwrap();
        adapter.shutdown(&instance).await.unwrap();
    }

    #[tokio::test]
    async fn generic_adapter_uses_secondary_env_and_distinct_id() {
        let workspace = std::env::temp_dir().join(format!("gbd-generic-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&workspace).unwrap();
        let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/mock_acp_agent.py");
        std::env::set_var(
            crate::adapter_registry::SECONDARY_ACP_ENV,
            &executable,
        );
        let adapter = GrokAcpAdapter::generic(Arc::new(AcpRuntime::new()), Arc::new(NoopEventBus));
        assert_eq!(
            adapter.adapter_id(),
            crate::adapter_registry::GENERIC_ADAPTER_ID
        );
        let instance = adapter
            .spawn(RuntimeLaunchConfig {
                executable: String::new(),
                workspace_root: workspace.to_string_lossy().into(),
                model: None,
                sandbox: "workspace".into(),
                privacy_mode: crate::platform::PrivacyMode::Strict,
                approval_policy: "workspace_edit".into(),
                rules: None,
                agent_profile: None,
            })
            .await
            .unwrap();
        std::env::remove_var(crate::adapter_registry::SECONDARY_ACP_ENV);
        assert_eq!(instance.adapter_id, crate::adapter_registry::GENERIC_ADAPTER_ID);
        let session = instance.session_id.clone().unwrap();
        adapter.cancel(&instance, &session).await.unwrap();
        adapter.shutdown(&instance).await.unwrap();
    }
}
