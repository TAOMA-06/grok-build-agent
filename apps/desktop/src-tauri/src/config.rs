//! Persistent app settings. API keys live in Keychain (see `secrets`), not JSON.

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
    pub grok_path: String,
    pub model: String,
    pub always_approve: bool,
    pub use_harness: bool,
    pub cwd: String,
    pub onboarding_done: bool,
    /// Present only for wire compatibility with the UI password field.
    /// Never persisted to disk — stored in Keychain via `secrets`.
    #[serde(default, skip_serializing)]
    pub api_key: String,
    pub theme: String,
}

/// On-disk shape without secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsFile {
    pub grok_path: String,
    pub model: String,
    pub always_approve: bool,
    pub use_harness: bool,
    pub cwd: String,
    pub onboarding_done: bool,
    pub theme: String,
    /// Legacy field: migrated to Keychain then deleted.
    #[serde(default)]
    pub api_key: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            grok_path: String::new(),
            model: "grok-build".into(),
            always_approve: false,
            use_harness: true,
            cwd: String::new(),
            onboarding_done: false,
            api_key: String::new(),
            theme: "dark".into(),
        }
    }
}

fn config_dir() -> Result<PathBuf, ConfigError> {
    let home = std::env::var("HOME").map_err(|_| ConfigError::Message("HOME not set".into()))?;
    let dir = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("GrokBuildDesktop");
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
        if crate::secrets::get_api_key()
            .ok()
            .flatten()
            .is_some()
        {
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
        grok_path: file.grok_path,
        model: file.model,
        always_approve: file.always_approve,
        use_harness: file.use_harness,
        cwd: file.cwd,
        onboarding_done: file.onboarding_done,
        // UI loads empty; secret stays in Keychain / env.
        api_key: String::new(),
        theme: file.theme,
    })
}

pub fn save_settings(settings: &AppSettings) -> Result<(), ConfigError> {
    // Persist secret only to Keychain.
    if !settings.api_key.is_empty() {
        crate::secrets::set_api_key(&settings.api_key)
            .map_err(|e| ConfigError::Message(e.to_string()))?;
    }

    let file = AppSettingsFile {
        grok_path: settings.grok_path.clone(),
        model: settings.model.clone(),
        always_approve: settings.always_approve,
        use_harness: settings.use_harness,
        cwd: settings.cwd.clone(),
        onboarding_done: settings.onboarding_done,
        api_key: None,
        theme: settings.theme.clone(),
    };
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(&file)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn config_dir_path() -> Result<String, ConfigError> {
    Ok(config_dir()?.to_string_lossy().to_string())
}
