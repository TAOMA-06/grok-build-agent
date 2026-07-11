use crate::acp::AcpError;
use crate::contracts::{LocalAttachmentRef, PromptContent, PromptResource};
use std::path::Path;

const MAX_FILES: usize = 10;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
const MAX_RICH_BYTES: u64 = 10 * 1024 * 1024;

fn mime_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "pdf" => Some("application/pdf"),
        "txt" | "md" | "mdx" | "json" | "jsonl" | "yaml" | "yml" | "toml" | "xml" | "csv"
        | "tsv" | "js" | "jsx" | "ts" | "tsx" | "css" | "scss" | "html" | "htm" | "py" | "rs"
        | "go" | "java" | "kt" | "swift" | "c" | "h" | "cpp" | "hpp" | "sh" | "zsh" | "bash"
        | "sql" | "graphql" | "gql" | "ini" | "conf" | "log" => Some("text/plain"),
        _ => None,
    }
}

fn per_file_limit(mime: &str) -> u64 {
    if mime.starts_with("text/") {
        MAX_TEXT_BYTES
    } else {
        MAX_RICH_BYTES
    }
}

fn validate_count_and_total(files: &[LocalAttachmentRef]) -> Result<(), AcpError> {
    if files.len() > MAX_FILES {
        return Err(AcpError::Message(format!(
            "attach at most {MAX_FILES} files"
        )));
    }
    let total = files
        .iter()
        .try_fold(0_u64, |sum, file| {
            sum.checked_add(file.size_bytes.unwrap_or(0))
        })
        .ok_or_else(|| AcpError::Message("attachment size overflow".into()))?;
    if total > MAX_TOTAL_BYTES {
        return Err(AcpError::Message(
            "attachments exceed the 20 MB total limit".into(),
        ));
    }
    Ok(())
}

pub fn inspect_paths(paths: Vec<String>) -> Result<Vec<LocalAttachmentRef>, AcpError> {
    if paths.len() > MAX_FILES {
        return Err(AcpError::Message(format!(
            "attach at most {MAX_FILES} files"
        )));
    }
    let mut files = Vec::with_capacity(paths.len());
    let mut total = 0_u64;
    for raw in paths {
        let path = Path::new(&raw);
        let mime = mime_for_path(path).ok_or_else(|| {
            AcpError::Message(format!(
                "{} is not a supported text, image, or PDF file",
                path.file_name().and_then(|v| v.to_str()).unwrap_or(&raw)
            ))
        })?;
        let metadata = std::fs::metadata(path)
            .map_err(|e| AcpError::Message(format!("cannot read {}: {e}", path.display())))?;
        if !metadata.is_file() {
            return Err(AcpError::Message(format!(
                "{} is not a file",
                path.display()
            )));
        }
        let size = metadata.len();
        if size > per_file_limit(mime) {
            return Err(AcpError::Message(format!(
                "{} exceeds the {} limit",
                path.display(),
                if mime.starts_with("text/") {
                    "1 MB"
                } else {
                    "10 MB"
                }
            )));
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| AcpError::Message("attachment size overflow".into()))?;
        if total > MAX_TOTAL_BYTES {
            return Err(AcpError::Message(
                "attachments exceed the 20 MB total limit".into(),
            ));
        }
        files.push(LocalAttachmentRef {
            id: uuid::Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&raw)
                .to_string(),
            path: raw,
            mime_type: mime.to_string(),
            size_bytes: Some(size),
        });
    }
    Ok(files)
}

pub fn prepare(files: Vec<LocalAttachmentRef>) -> Result<Vec<PromptContent>, AcpError> {
    validate_count_and_total(&files)?;
    let mut content = Vec::with_capacity(files.len());
    let mut actual_total = 0_u64;
    for file in files {
        let path = Path::new(&file.path);
        let mime = mime_for_path(path).ok_or_else(|| {
            AcpError::Message(format!("{} is not a supported attachment", file.name))
        })?;
        let bytes = std::fs::read(path)
            .map_err(|e| AcpError::Message(format!("cannot read {}: {e}", path.display())))?;
        let size = bytes.len() as u64;
        if size > per_file_limit(mime) {
            return Err(AcpError::Message(format!(
                "{} exceeds the attachment limit",
                file.name
            )));
        }
        actual_total = actual_total
            .checked_add(size)
            .ok_or_else(|| AcpError::Message("attachment size overflow".into()))?;
        if actual_total > MAX_TOTAL_BYTES {
            return Err(AcpError::Message(
                "attachments exceed the 20 MB total limit".into(),
            ));
        }
        let uri = format!("attachment://{}/{}", file.id, file.name.replace(' ', "%20"));
        if mime.starts_with("image/") {
            content.push(PromptContent::Image {
                data: encode_base64(&bytes),
                mime_type: mime.to_string(),
                uri: Some(uri),
            });
        } else if mime.starts_with("text/") {
            let text = String::from_utf8(bytes)
                .map_err(|_| AcpError::Message(format!("{} is not valid UTF-8 text", file.name)))?;
            content.push(PromptContent::Resource {
                resource: PromptResource {
                    uri,
                    mime_type: Some(mime.to_string()),
                    text: Some(text),
                    blob: None,
                },
            });
        } else {
            content.push(PromptContent::Resource {
                resource: PromptResource {
                    uri,
                    mime_type: Some(mime.to_string()),
                    text: None,
                    blob: Some(encode_base64(&bytes)),
                },
            });
        }
    }
    Ok(content)
}

pub fn validate_prompt_content(content: &[PromptContent]) -> Result<(), AcpError> {
    let mut files = 0_usize;
    let mut total = 0_u64;
    for block in content {
        let (mime, size) = match block {
            PromptContent::Text { .. } => continue,
            PromptContent::Image {
                data, mime_type, ..
            } => {
                if !matches!(
                    mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                ) {
                    return Err(AcpError::Message(format!(
                        "unsupported image type {mime_type}"
                    )));
                }
                (mime_type.as_str(), decoded_base64_size(data))
            }
            PromptContent::Resource { resource } => {
                let mime = resource
                    .mime_type
                    .as_deref()
                    .unwrap_or("application/octet-stream");
                if mime != "application/pdf" && !mime.starts_with("text/") {
                    return Err(AcpError::Message(format!(
                        "unsupported resource type {mime}"
                    )));
                }
                let size = resource
                    .text
                    .as_ref()
                    .map(|value| value.len() as u64)
                    .or_else(|| {
                        resource
                            .blob
                            .as_ref()
                            .map(|value| decoded_base64_size(value))
                    })
                    .unwrap_or(0);
                (mime, size)
            }
            PromptContent::ResourceLink { .. } => {
                return Err(AcpError::Message(
                    "resource links are not accepted; attach the file content instead".into(),
                ));
            }
        };
        files += 1;
        if files > MAX_FILES || size > per_file_limit(mime) {
            return Err(AcpError::Message("attachment limits exceeded".into()));
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| AcpError::Message("attachment size overflow".into()))?;
    }
    if total > MAX_TOTAL_BYTES {
        return Err(AcpError::Message(
            "attachments exceed the 20 MB total limit".into(),
        ));
    }
    Ok(())
}

fn decoded_base64_size(value: &str) -> u64 {
    let padding = value
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    ((value.len() * 3) / 4).saturating_sub(padding) as u64
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let a = chunk[0];
        let b = *chunk.get(1).unwrap_or(&0);
        let c = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[(((a & 0x03) << 4) | (b >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b & 0x0f) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(c & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_value() {
        assert_eq!(encode_base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn rejects_resource_links() {
        let result = validate_prompt_content(&[PromptContent::ResourceLink {
            uri: "file:///tmp/a".into(),
            name: None,
            mime_type: Some("text/plain".into()),
            description: None,
        }]);
        assert!(result.is_err());
    }
}
