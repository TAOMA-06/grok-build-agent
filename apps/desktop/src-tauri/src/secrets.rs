//! Optional API-key storage plus the private UI/Host IPC credential.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SERVICE: &str = "com.grokbuilddesktop.community";
const USER: &str = "xai_api_key";
const HOST_IPC_TOKEN_FILE: &str = "agent-host-ipc-token-v1";

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
    use std::fs::OpenOptions;
    use std::io::Write;

    let root = crate::config::config_dir_path()
        .map_err(|error| SecretError::Message(error.to_string()))?;
    std::fs::create_dir_all(&root)
        .map_err(|error| SecretError::Message(format!("create config directory: {error}")))?;
    let path = std::path::Path::new(&root).join(HOST_IPC_TOKEN_FILE);

    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if token.len() >= 32 {
            return Ok(token);
        }
        return Err(SecretError::Message(
            "Agent Host IPC credential is unexpectedly short".into(),
        ));
    }

    let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            file.write_all(token.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|error| SecretError::Message(format!("write IPC credential: {error}")))?;
            Ok(token)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = std::fs::read_to_string(&path)
                .map_err(|error| SecretError::Message(format!("read IPC credential: {error}")))?;
            let existing = existing.trim().to_string();
            if existing.len() < 32 {
                return Err(SecretError::Message(
                    "Agent Host IPC credential is unexpectedly short".into(),
                ));
            }
            Ok(existing)
        }
        Err(error) => Err(SecretError::Message(format!(
            "create IPC credential: {error}"
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

/// Redact secrets from log / error strings.
pub fn redact_secrets(text: &str) -> String {
    let mut out = text.to_string();
    // Redaction runs on every audited Host RPC. Never read Keychain from this
    // hot path: a background LaunchAgent may be unable to present the access
    // dialog, and credential lookup must not block or abort an unrelated RPC.
    // An explicitly supplied API key is already present in the Host environment.
    if let Ok(key) = std::env::var("XAI_API_KEY") {
        if key.len() >= 8 {
            out = out.replace(&key, "[REDACTED]");
        }
    }
    out = redact_private_key_blocks(&out);
    out = redact_jwt_tokens(&out);
    out = redact_prefixed_tokens(&out, "xai-");
    out = redact_prefixed_tokens(&out, "sk-");
    out = redact_prefixed_tokens(&out, "ghp_");
    out = redact_prefixed_tokens(&out, "github_pat_");
    out = redact_prefixed_tokens(&out, "glpat-");
    out = redact_prefixed_tokens(&out, "AKIA");
    out = redact_prefixed_tokens(&out, "AIza");
    out
}

/// Sensitive files should not be staged or transmitted by Strict Privacy Shield.
/// This intentionally errs on the side of caution; users can opt into Standard
/// mode when a key container is deliberately part of their task.
pub fn is_sensitive_attachment_name(name: &str) -> bool {
    let base = name
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();
    matches!(
        base.as_str(),
        ".env"
            | "credentials"
            | "credentials.json"
            | "id_dsa"
            | "id_ecdsa"
            | "id_ed25519"
            | "id_rsa"
            | "secrets.json"
            | "secrets.yaml"
            | "secrets.yml"
    ) || base.starts_with(".env.")
        || [".kdbx", ".key", ".p12", ".pem", ".pfx"]
            .iter()
            .any(|extension| base.ends_with(extension))
}

fn redact_prefixed_tokens(text: &str, prefix: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(relative_start) = text[cursor..].find(prefix) {
        let start = cursor + relative_start;
        out.push_str(&text[cursor..start]);
        let token_start = start + prefix.len();
        let token_end = text[token_start..]
            .char_indices()
            .take_while(|(_, character)| {
                character.is_ascii_alphanumeric() || *character == '_' || *character == '-'
            })
            .map(|(offset, character)| token_start + offset + character.len_utf8())
            .last()
            .unwrap_or(token_start);
        if token_end - token_start > 8 {
            out.push_str(prefix);
            out.push_str("[REDACTED]");
        } else {
            out.push_str(&text[start..token_end]);
        }
        cursor = token_end;
    }
    out.push_str(&text[cursor..]);
    out
}

fn redact_private_key_blocks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut remaining = text;
    while let Some(start) = remaining.find("-----BEGIN ") {
        let (before, block) = remaining.split_at(start);
        out.push_str(before);
        let header_end = block.find('\n').unwrap_or(block.len());
        let header = &block[..header_end];
        if !header.contains("PRIVATE KEY-----") {
            out.push_str(header);
            remaining = &block[header_end..];
            continue;
        }

        let footer_start = block[header_end..]
            .find("-----END ")
            .map(|offset| header_end + offset);
        let Some(footer_start) = footer_start else {
            out.push_str("[REDACTED:PRIVATE_KEY]");
            remaining = "";
            break;
        };
        let footer_end = block[footer_start..]
            .find('\n')
            .map(|offset| footer_start + offset)
            .unwrap_or(block.len());
        let footer = &block[footer_start..footer_end];
        if footer.contains("PRIVATE KEY-----") {
            out.push_str("[REDACTED:PRIVATE_KEY]");
            remaining = &block[footer_end..];
        } else {
            out.push_str(header);
            remaining = &block[header_end..];
        }
    }
    out.push_str(remaining);
    out
}

fn redact_jwt_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(relative_start) = text[cursor..].find("eyJ") {
        let start = cursor + relative_start;
        out.push_str(&text[cursor..start]);
        let token_end = text[start..]
            .char_indices()
            .take_while(|(_, character)| {
                character.is_ascii_alphanumeric()
                    || matches!(*character, '-' | '_' | '.')
            })
            .map(|(offset, character)| start + offset + character.len_utf8())
            .last()
            .unwrap_or(start);
        let candidate = &text[start..token_end];
        let parts: Vec<_> = candidate.split('.').collect();
        if parts.len() == 3
            && parts.iter().all(|part| part.len() >= 8)
            && parts.first().is_some_and(|part| part.starts_with("eyJ"))
        {
            out.push_str("[REDACTED:JWT]");
        } else {
            out.push_str(candidate);
        }
        cursor = token_end;
    }
    out.push_str(&text[cursor..]);
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

    #[test]
    fn redact_preserves_unicode_without_panicking() {
        let text = "制定中文计划，再检查 xai-abcdefghijklmnop 是否脱敏";
        let redacted = redact_secrets(text);
        assert!(redacted.starts_with("制定中文计划，再检查 "));
        assert!(!redacted.contains("abcdefghijklmnop"));
    }

    #[test]
    fn redact_masks_common_credentials_and_private_keys() {
        let text = "ghp_1234567890abcdefghijkl eyJabcdefgh.abcdefgh.abcdefgh BEGIN\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("1234567890abcdefghijkl"));
        assert!(!redacted.contains("eyJabcdefgh.abcdefgh.abcdefgh"));
        assert!(!redacted.contains("\nsecret\n"));
        assert!(redacted.contains("[REDACTED:PRIVATE_KEY]"));
    }

    #[test]
    fn sensitive_attachment_names_are_detected() {
        assert!(is_sensitive_attachment_name("/tmp/.env.production"));
        assert!(is_sensitive_attachment_name("attachment://id/id_ed25519"));
        assert!(is_sensitive_attachment_name("credentials.json"));
        assert!(!is_sensitive_attachment_name("src/credentials.ts"));
    }
}
