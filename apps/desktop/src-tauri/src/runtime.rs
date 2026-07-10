//! Runtime health / probe (Hermes managed-runtime analogue for external `grok`).

use crate::acp;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub grok: acp::GrokProbe,
    pub authenticated: bool,
    pub auth_method: Option<String>,
    pub auth_hint: Option<String>,
    pub grok_home: Option<String>,
    pub ready: bool,
    pub checklist: Vec<HealthItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthItem {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: Option<String>,
}

pub fn health(configured_path: Option<&str>) -> RuntimeHealth {
    let grok = acp::probe_grok(configured_path);
    let home = std::env::var("HOME").ok();
    let grok_home = home.as_ref().map(|h| format!("{h}/.grok"));

    let (authenticated, auth_method, auth_hint) = detect_auth(home.as_deref());

    let checklist = vec![
        HealthItem {
            id: "binary".into(),
            label: "Grok CLI installed".into(),
            ok: grok.found,
            detail: grok.path.clone().or_else(|| grok.error.clone()),
        },
        HealthItem {
            id: "version".into(),
            label: "Version readable".into(),
            ok: grok
                .version
                .as_ref()
                .map(|v| !v.is_empty())
                .unwrap_or(false),
            detail: grok.version.clone(),
        },
        HealthItem {
            id: "auth".into(),
            label: "Authentication".into(),
            ok: authenticated,
            detail: auth_hint.clone().or_else(|| auth_method.clone()),
        },
    ];

    let ready = grok.found && authenticated;

    RuntimeHealth {
        grok,
        authenticated,
        auth_method,
        auth_hint,
        grok_home,
        ready,
        checklist,
    }
}

fn detect_auth(home: Option<&str>) -> (bool, Option<String>, Option<String>) {
    if let Ok(key) = std::env::var("XAI_API_KEY") {
        if !key.trim().is_empty() {
            return (
                true,
                Some("env:XAI_API_KEY".into()),
                Some("API key present in environment".into()),
            );
        }
    }

    if let Some(h) = home {
        let auth_path = PathBuf::from(h).join(".grok").join("auth.json");
        if auth_path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&auth_path) {
                // Treat non-empty auth file as signed-in (do not parse secrets).
                if raw.trim().len() > 10 {
                    return (
                        true,
                        Some("file:auth.json".into()),
                        Some(format!("Found {}", auth_path.display())),
                    );
                }
            }
            return (
                false,
                Some("file:auth.json".into()),
                Some("auth.json exists but looks empty — try `grok login`".into()),
            );
        }
    }

    (
        false,
        None,
        Some("Not authenticated. Run `grok login` or set XAI_API_KEY.".into()),
    )
}

/// Apply optional API key into process env for the agent child (not persisted env system-wide).
#[allow(dead_code)]
pub fn apply_api_key_to_env(api_key: &str) {
    crate::secrets::apply_api_key_to_env(api_key);
}
