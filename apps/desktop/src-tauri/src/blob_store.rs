//! Content-addressed blob storage for large/runtime-raw payloads.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum BlobError {
    #[error("invalid blob digest")]
    InvalidDigest,
    #[error("blob digest mismatch")]
    DigestMismatch,
    #[error("blob exceeds read limit")]
    ReadLimitExceeded,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobRef {
    pub digest: String,
    pub size: u64,
    pub media_type: String,
}

#[derive(Clone)]
pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    pub fn new(root: PathBuf) -> Result<Self, BlobError> {
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn put(&self, bytes: &[u8], media_type: &str) -> Result<BlobRef, BlobError> {
        let digest = hex::encode(Sha256::digest(bytes));
        let destination = self.path_for_digest(&digest)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }

        if !destination.exists() {
            let temp = destination.with_extension(format!("tmp-{}", Uuid::new_v4()));
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            match fs::rename(&temp, &destination) {
                Ok(()) => {}
                Err(error) if destination.exists() => {
                    let _ = fs::remove_file(&temp);
                    if !destination.exists() {
                        return Err(error.into());
                    }
                }
                Err(error) => {
                    let _ = fs::remove_file(&temp);
                    return Err(error.into());
                }
            }
        }

        Ok(BlobRef {
            digest,
            size: bytes.len() as u64,
            media_type: media_type.trim().to_string(),
        })
    }

    pub fn get(&self, digest: &str, max_bytes: usize) -> Result<Vec<u8>, BlobError> {
        let path = self.path_for_digest(digest)?;
        let metadata = fs::metadata(&path)?;
        if metadata.len() > max_bytes as u64 {
            return Err(BlobError::ReadLimitExceeded);
        }
        let file = fs::File::open(path)?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(max_bytes as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > max_bytes {
            return Err(BlobError::ReadLimitExceeded);
        }
        if hex::encode(Sha256::digest(&bytes)) != digest {
            return Err(BlobError::DigestMismatch);
        }
        Ok(bytes)
    }

    pub fn delete(&self, digest: &str) -> Result<bool, BlobError> {
        let path = self.path_for_digest(digest)?;
        if !path.exists() {
            return Ok(false);
        }
        fs::remove_file(path)?;
        Ok(true)
    }

    pub fn disk_usage(&self) -> Result<u64, BlobError> {
        let mut total = 0_u64;
        for prefix in fs::read_dir(&self.root)? {
            let prefix = prefix?;
            if !prefix.file_type()?.is_dir() {
                continue;
            }
            for entry in fs::read_dir(prefix.path())? {
                let entry = entry?;
                if entry.file_type()?.is_file() {
                    total = total.saturating_add(entry.metadata()?.len());
                }
            }
        }
        Ok(total)
    }

    fn path_for_digest(&self, digest: &str) -> Result<PathBuf, BlobError> {
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(BlobError::InvalidDigest);
        }
        Ok(self.root.join(&digest[..2]).join(&digest[2..]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> BlobStore {
        BlobStore::new(std::env::temp_dir().join(format!("gbd-blobs-{}", Uuid::new_v4()))).unwrap()
    }

    #[test]
    fn content_addressed_roundtrip_and_deduplication() {
        let store = store();
        let first = store.put(b"hello", "text/plain").unwrap();
        let second = store.put(b"hello", "text/plain").unwrap();
        assert_eq!(first.digest, second.digest);
        assert_eq!(store.get(&first.digest, 100).unwrap(), b"hello");
    }

    #[test]
    fn rejects_invalid_digest_and_read_over_limit() {
        let store = store();
        assert!(matches!(
            store.get("../escape", 100),
            Err(BlobError::InvalidDigest)
        ));
        let blob = store.put(b"hello", "text/plain").unwrap();
        assert!(matches!(
            store.get(&blob.digest, 2),
            Err(BlobError::ReadLimitExceeded)
        ));
    }
}
