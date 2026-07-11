//! macOS Keychain (via `keyring`) for API keys — never log secret values.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SERVICE: &str = "com.grokbuilddesktop.community";
const USER: &str = "xai_api_key";
const HOST_IPC_USER: &str = "agent_host_ipc_v1";

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("{0}")]
    Message(String),
}

impl Serialize for SecretError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn entry() -> Result<keyring::Entry, SecretError> {
    entry_for(USER)
}

fn entry_for(user: &str) -> Result<keyring::Entry, SecretError> {
    keyring::Entry::new(SERVICE, user)
        .map_err(|e| SecretError::Message(format!("keychain entry: {e}")))
}

pub fn get_or_create_host_ipc_token() -> Result<String, SecretError> {
    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    {
        return get_or_create_protected_host_ipc_token();
    }
    #[cfg(any(not(target_os = "macos"), debug_assertions))]
    {
        get_or_create_legacy_host_ipc_token()
    }
}

#[cfg(any(not(target_os = "macos"), debug_assertions))]
fn get_or_create_legacy_host_ipc_token() -> Result<String, SecretError> {
    let entry = entry_for(HOST_IPC_USER)?;
    match entry.get_password() {
        Ok(token) if token.len() >= 32 => Ok(token),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
            entry
                .set_password(&token)
                .map_err(|error| SecretError::Message(format!("keychain write failed: {error}")))?;
            Ok(token)
        }
        Err(error) => Err(SecretError::Message(format!(
            "keychain read failed: {error}"
        ))),
    }
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn get_or_create_protected_host_ipc_token() -> Result<String, SecretError> {
    use security_framework::passwords::{
        generic_password, set_generic_password_options, PasswordOptions,
    };
    use security_framework_sys::base::errSecItemNotFound;

    let team_id = option_env!("APPLE_TEAM_ID")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            SecretError::Message(
                "signed release is missing APPLE_TEAM_ID for the shared Keychain access group"
                    .into(),
            )
        })?;
    let access_group = format!("{team_id}.com.grokbuilddesktop.community.shared");
    let options = || {
        let mut options = PasswordOptions::new_generic_password(SERVICE, HOST_IPC_USER);
        options.set_access_group(&access_group);
        options.use_protected_keychain();
        options
    };

    match generic_password(options()) {
        Ok(bytes) => {
            let token = String::from_utf8(bytes)
                .map_err(|_| SecretError::Message("Keychain IPC token is not UTF-8".into()))?;
            if token.len() < 32 {
                return Err(SecretError::Message(
                    "Keychain IPC token is unexpectedly short".into(),
                ));
            }
            Ok(token)
        }
        Err(error) if error.code() == errSecItemNotFound => {
            let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
            set_generic_password_options(token.as_bytes(), options()).map_err(|error| {
                SecretError::Message(format!("protected Keychain write failed: {error}"))
            })?;
            Ok(token)
        }
        Err(error) => Err(SecretError::Message(format!(
            "protected Keychain read failed: {error}"
        ))),
    }
}

pub fn get_api_key() -> Result<Option<String>, SecretError> {
    match entry()?.get_password() {
        Ok(p) if p.is_empty() => Ok(None),
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SecretError::Message(format!("keychain read failed: {e}"))),
    }
}

pub fn set_api_key(key: &str) -> Result<(), SecretError> {
    let key = key.trim();
    if key.is_empty() {
        return delete_api_key();
    }
    entry()?
        .set_password(key)
        .map_err(|e| SecretError::Message(format!("keychain write failed: {e}")))
}

pub fn delete_api_key() -> Result<(), SecretError> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SecretError::Message(format!("keychain delete failed: {e}"))),
    }
}

/// Apply key to process env for agent spawn without logging it.
pub fn apply_api_key_to_env(api_key: &str) {
    if !api_key.trim().is_empty() {
        // SAFETY: single-threaded at settings apply points; agent spawn reads env.
        std::env::set_var("XAI_API_KEY", api_key.trim());
    }
}

pub fn load_api_key_into_env() {
    if let Ok(Some(key)) = get_api_key() {
        apply_api_key_to_env(&key);
    }
}

/// Redact secrets from log / error strings.
pub fn redact_secrets(text: &str) -> String {
    let mut out = text.to_string();
    if let Ok(Some(key)) = get_api_key() {
        if key.len() >= 8 {
            out = out.replace(&key, "[REDACTED]");
        }
    }
    if let Ok(key) = std::env::var("XAI_API_KEY") {
        if key.len() >= 8 {
            out = out.replace(&key, "[REDACTED]");
        }
    }
    out = redact_prefixed_tokens(&out, "xai-");
    out = redact_prefixed_tokens(&out, "sk-");
    out
}

fn redact_prefixed_tokens(text: &str, prefix: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if text[i..].starts_with(prefix) {
            let start = i;
            i += prefix.len();
            while i < bytes.len() {
                let c = bytes[i] as char;
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    i += 1;
                } else {
                    break;
                }
            }
            if i - start > prefix.len() + 8 {
                out.push_str(prefix);
                out.push_str("[REDACTED]");
                continue;
            }
            out.push_str(&text[start..i]);
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub has_api_key: bool,
    pub storage: String,
}

pub fn status() -> SecretStatus {
    SecretStatus {
        has_api_key: get_api_key().ok().flatten().is_some(),
        storage: "keychain".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_masks_patterns() {
        let s = redact_secrets("token xai-abcdefghijklmnop and sk-1234567890abcdef");
        assert!(!s.contains("xai-abcdefghijklmnop"));
        assert!(!s.contains("sk-1234567890abcdef"));
        assert!(s.contains("[REDACTED]") || s.contains("xai-[REDACTED]"));
    }
}
