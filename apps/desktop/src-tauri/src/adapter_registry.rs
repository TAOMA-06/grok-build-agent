//! Runtime adapter catalog for Cursor/Codex parity wave W1-A.
//!
//! Production tasks still launch through Grok ACP. This module makes a second
//! ACP-compatible channel discoverable (`generic-acp`) when
//! `GROK_BUILD_SECONDARY_ACP` points at an executable (or mock fixture).

use crate::platform::AdapterCatalogEntry;
use std::path::Path;

pub const GROK_ADAPTER_ID: &str = "grok-acp";
pub const GENERIC_ADAPTER_ID: &str = "generic-acp";
pub const SECONDARY_ACP_ENV: &str = "GROK_BUILD_SECONDARY_ACP";

/// Optional path to a second ACP-compatible agent binary.
/// Preference order: explicit override → env `GROK_BUILD_SECONDARY_ACP`.
pub fn secondary_acp_path() -> Option<String> {
    resolve_secondary_acp_path(None)
}

pub fn resolve_secondary_acp_path(override_path: Option<&str>) -> Option<String> {
    override_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var(SECONDARY_ACP_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn path_looks_runnable(path: &str) -> bool {
    let candidate = Path::new(path);
    candidate.is_file()
}

/// Static + settings/env-driven adapter catalog. Does not spawn processes.
pub fn list_adapter_catalog(
    grok_path: Option<&str>,
    secondary_override: Option<&str>,
) -> Vec<AdapterCatalogEntry> {
    let grok = grok_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string);
    // Empty grok path still means "use PATH resolution" — treat as configured.
    let grok_configured = grok
        .as_ref()
        .map(|path| path_looks_runnable(path))
        .unwrap_or(true);

    let secondary = resolve_secondary_acp_path(secondary_override);
    let secondary_configured = secondary
        .as_ref()
        .map(|path| path_looks_runnable(path))
        .unwrap_or(false);

    vec![
        AdapterCatalogEntry {
            adapter_id: GROK_ADAPTER_ID.into(),
            label: "Grok Build ACP".into(),
            configured: grok_configured,
            available: grok_configured,
            models: Vec::new(),
            notes: "Default executor. Used unless Settings prefers Secondary ACP.".into(),
        },
        AdapterCatalogEntry {
            adapter_id: GENERIC_ADAPTER_ID.into(),
            label: "Secondary ACP".into(),
            configured: secondary_configured,
            available: secondary_configured,
            models: Vec::new(),
            notes: if secondary_configured {
                format!(
                    "Codex or other ACP. Mixed planning uses this for Plan mode; Preferred runtime can run the whole task here."
                )
            } else {
                format!(
                    "Set Secondary ACP path in Settings or {SECONDARY_ACP_ENV} (e.g. Codex ACP)."
                )
            },
        },
    ]
}

/// True when the catalog satisfies the W1-A skeleton exit: ≥1 primary + discoverable secondary slot.
pub fn catalog_has_secondary_slot(entries: &[AdapterCatalogEntry]) -> bool {
    let has_grok = entries.iter().any(|entry| entry.adapter_id == GROK_ADAPTER_ID);
    let has_generic = entries
        .iter()
        .any(|entry| entry.adapter_id == GENERIC_ADAPTER_ID);
    has_grok && has_generic
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn catalog_always_lists_grok_and_generic_slots() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var(SECONDARY_ACP_ENV);
        let catalog = list_adapter_catalog(None, None);
        assert!(catalog_has_secondary_slot(&catalog));
        assert_eq!(catalog.len(), 2);
        assert!(catalog[0].available);
        assert!(!catalog[1].configured);
        assert!(catalog[1].notes.contains("Settings") || catalog[1].notes.contains("ACP"));
    }

    #[test]
    fn secondary_channel_marks_configured_when_env_points_at_file() {
        let _guard = ENV_LOCK.lock().unwrap();
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/mock_acp_agent.py");
        std::env::set_var(SECONDARY_ACP_ENV, &fixture);
        let catalog = list_adapter_catalog(None, None);
        std::env::remove_var(SECONDARY_ACP_ENV);
        let secondary = catalog
            .iter()
            .find(|entry| entry.adapter_id == GENERIC_ADAPTER_ID)
            .expect("generic adapter");
        assert!(secondary.configured);
        assert!(secondary.available);
    }

    #[test]
    fn settings_override_wins_over_missing_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var(SECONDARY_ACP_ENV);
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/mock_acp_agent.py");
        let catalog = list_adapter_catalog(None, Some(fixture.to_str().unwrap()));
        assert!(catalog
            .iter()
            .find(|entry| entry.adapter_id == GENERIC_ADAPTER_ID)
            .is_some_and(|entry| entry.configured));
    }
}
