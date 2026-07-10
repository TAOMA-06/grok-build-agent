//! Persistent app settings (Hermes-style config store).

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
    /// Optional API key stored locally for headless auth (user-provided).
    pub api_key: String,
    pub theme: String,
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
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path)?;
    let settings: AppSettings = serde_json::from_str(&raw)?;
    Ok(settings)
}

pub fn save_settings(settings: &AppSettings) -> Result<(), ConfigError> {
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(settings)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn config_dir_path() -> Result<String, ConfigError> {
    Ok(config_dir()?.to_string_lossy().to_string())
}
