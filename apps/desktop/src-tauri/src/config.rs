//! Persistent app settings. API keys live in Keychain (see `secrets`), not JSON.

use crate::contracts::SandboxMode;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Serialize for ConfigError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "settings_schema_version")]
    pub schema_version: u32,
    pub grok_path: String,
    #[serde(default)]
    pub cli_path_override: String,
    pub model: String,
    #[serde(default = "default_mode")]
    pub default_mode: String,
    #[serde(default = "default_permission_policy")]
    pub permission_policy: String,
    #[serde(default = "default_true")]
    pub auto_update_cli: bool,
    pub always_approve: bool,
    pub use_harness: bool,
    #[serde(default)]
    pub sandbox: SandboxMode,
    pub cwd: String,
    pub onboarding_done: bool,
    /// Present only for wire compatibility with the UI password field.
    /// Never persisted to disk — stored in Keychain via `secrets`.
    #[serde(default, skip_serializing)]
    pub api_key: String,
    pub theme: String,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub compact_mode: bool,
    #[serde(default)]
    pub multiline_mode: bool,
    #[serde(default)]
    pub show_timestamps: bool,
}

/// On-disk shape without secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsFile {
    #[serde(default = "settings_schema_version")]
    pub schema_version: u32,
    pub grok_path: String,
    #[serde(default)]
    pub cli_path_override: String,
    pub model: String,
    #[serde(default = "default_mode")]
    pub default_mode: String,
    #[serde(default = "default_permission_policy")]
    pub permission_policy: String,
    #[serde(default = "default_true")]
    pub auto_update_cli: bool,
    pub always_approve: bool,
    pub use_harness: bool,
    #[serde(default)]
    pub sandbox: SandboxMode,
    pub cwd: String,
    pub onboarding_done: bool,
    pub theme: String,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub compact_mode: bool,
    #[serde(default)]
    pub multiline_mode: bool,
    #[serde(default)]
    pub show_timestamps: bool,
    /// Legacy field: migrated to Keychain then deleted.
    #[serde(default)]
    pub api_key: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: settings_schema_version(),
            grok_path: String::new(),
            cli_path_override: String::new(),
            model: "grok-build".into(),
            default_mode: default_mode(),
            permission_policy: default_permission_policy(),
            auto_update_cli: true,
            always_approve: false,
            use_harness: false,
            sandbox: SandboxMode::Workspace,
            cwd: String::new(),
            onboarding_done: false,
            api_key: String::new(),
            theme: "light".into(),
            locale: default_locale(),
            compact_mode: false,
            multiline_mode: false,
            show_timestamps: false,
        }
    }
}

fn default_locale() -> String {
    "system".into()
}

fn settings_schema_version() -> u32 {
    3
}

fn default_mode() -> String {
    "agent".into()
}

fn default_permission_policy() -> String {
    "workspace_edit".into()
}

fn default_true() -> bool {
    true
}

fn config_dir() -> Result<PathBuf, ConfigError> {
    #[cfg(target_os = "windows")]
    let dir = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| ConfigError::Message("APPDATA not set".into()))?
        .join("GrokBuildDesktop");

    #[cfg(target_os = "macos")]
    let dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| ConfigError::Message("HOME not set".into()))?
        .join("Library")
        .join("Application Support")
        .join("GrokBuildDesktop");

    #[cfg(all(unix, not(target_os = "macos")))]
    let dir = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        })
        .ok_or_else(|| ConfigError::Message("HOME and XDG_DATA_HOME not set".into()))?
        .join("grok-build-desktop");

    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn config_path() -> Result<PathBuf, ConfigError> {
    Ok(config_dir()?.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, ConfigError> {
    let path = config_path()?;
    if !path.exists() {
        let mut s = AppSettings::default();
        // Surface keychain presence as a non-secret placeholder for the UI field.
        if crate::secrets::get_api_key().ok().flatten().is_some() {
            s.api_key = String::new(); // never return secret to frontend by default
        }
        return Ok(s);
    }
    let raw = fs::read_to_string(&path)?;
    let file: AppSettingsFile = serde_json::from_str(&raw)?;

    // One-time migration: move plaintext api_key into Keychain and rewrite file.
    if let Some(legacy) = file.api_key.as_ref().map(|s| s.trim().to_string()) {
        if !legacy.is_empty() {
            let _ = crate::secrets::set_api_key(&legacy);
            let cleaned = AppSettingsFile {
                api_key: None,
                ..file.clone()
            };
            let cleaned_raw = serde_json::to_string_pretty(&cleaned)?;
            fs::write(&path, cleaned_raw)?;
        }
    }

    Ok(AppSettings {
        schema_version: settings_schema_version(),
        grok_path: file.grok_path,
        cli_path_override: file.cli_path_override,
        model: file.model,
        default_mode: file.default_mode,
        permission_policy: file.permission_policy,
        auto_update_cli: file.auto_update_cli,
        always_approve: file.always_approve,
        use_harness: file.use_harness,
        sandbox: file.sandbox,
        cwd: file.cwd,
        onboarding_done: file.onboarding_done,
        // UI loads empty; secret stays in Keychain / env.
        api_key: String::new(),
        theme: file.theme,
        locale: file.locale,
        compact_mode: file.compact_mode,
        multiline_mode: file.multiline_mode,
        show_timestamps: file.show_timestamps,
    })
}

pub fn save_settings(settings: &AppSettings) -> Result<(), ConfigError> {
    // Persist secret only to Keychain.
    if !settings.api_key.is_empty() {
        crate::secrets::set_api_key(&settings.api_key)
            .map_err(|e| ConfigError::Message(e.to_string()))?;
    }

    let file = AppSettingsFile {
        schema_version: settings_schema_version(),
        grok_path: settings.grok_path.clone(),
        cli_path_override: settings.cli_path_override.clone(),
        model: settings.model.clone(),
        default_mode: settings.default_mode.clone(),
        permission_policy: settings.permission_policy.clone(),
        auto_update_cli: settings.auto_update_cli,
        always_approve: settings.always_approve,
        use_harness: settings.use_harness,
        sandbox: settings.sandbox,
        cwd: settings.cwd.clone(),
        onboarding_done: settings.onboarding_done,
        api_key: None,
        theme: settings.theme.clone(),
        locale: settings.locale.clone(),
        compact_mode: settings.compact_mode,
        multiline_mode: settings.multiline_mode,
        show_timestamps: settings.show_timestamps,
    };
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(&file)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn config_dir_path() -> Result<String, ConfigError> {
    Ok(config_dir()?.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_settings_receive_v3_defaults_without_losing_values() {
        let file: AppSettingsFile = serde_json::from_value(serde_json::json!({
            "grokPath": "/custom/grok",
            "model": "grok-build",
            "alwaysApprove": true,
            "useHarness": true,
            "cwd": "/project",
            "onboardingDone": true,
            "theme": "dark"
        }))
        .unwrap();
        assert_eq!(file.schema_version, 3);
        assert!(!file.compact_mode);
        assert!(!file.multiline_mode);
        assert!(!file.show_timestamps);
        assert_eq!(file.default_mode, "agent");
        assert_eq!(file.permission_policy, "workspace_edit");
        assert!(file.auto_update_cli);
        assert!(file.always_approve);
        assert!(file.use_harness);
        assert_eq!(file.cwd, "/project");
    }
}
