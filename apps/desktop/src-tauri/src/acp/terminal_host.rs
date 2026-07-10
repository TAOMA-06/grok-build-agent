//! Terminal host: spawn with argv arrays (never shell-concatenated).

use super::AcpError;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use uuid::Uuid;

pub struct TerminalSession {
    pub id: String,
    pub child: Mutex<Child>,
    pub pid: u32,
    pub output: Mutex<String>,
    pub exit_code: Mutex<Option<i32>>,
}

#[derive(Default)]
pub struct TerminalHost {
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
}

impl TerminalHost {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a terminal running `command` with `args` (no shell).
    pub async fn create(
        &self,
        workspace: &Path,
        command: &str,
        args: &[String],
        env: &[(String, String)],
    ) -> Result<Value, AcpError> {
        if command.trim().is_empty() {
            return Err(AcpError::Message("terminal command is empty".into()));
        }
        // Reject obvious shell metacharacters in the program path only;
        // args are passed as separate argv entries.
        if command.contains(['|', ';', '&', '`', '\n', '\r']) {
            return Err(AcpError::Message(
                "terminal command must be a program path, not a shell expression".into(),
            ));
        }

        let mut cmd = Command::new(command);
        cmd.args(args)
            .current_dir(workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (k, v) in env {
            cmd.env(k, v);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| AcpError::Message(format!("spawn terminal failed: {e}")))?;
        let pid = child.id().unwrap_or(0);
        let id = Uuid::new_v4().to_string();

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let session = Arc::new(TerminalSession {
            id: id.clone(),
            child: Mutex::new(child),
            pid,
            output: Mutex::new(String::new()),
            exit_code: Mutex::new(None),
        });

        {
            let session = session.clone();
            tokio::spawn(async move {
                if let Some(mut out) = stdout {
                    let mut buf = [0u8; 4096];
                    loop {
                        match out.read(&mut buf).await {
                            Ok(0) => break,
                            Ok(n) => {
                                let chunk = String::from_utf8_lossy(&buf[..n]);
                                session.output.lock().push_str(&chunk);
                            }
                            Err(_) => break,
                        }
                    }
                }
            });
        }
        {
            let session = session.clone();
            tokio::spawn(async move {
                if let Some(mut err) = stderr {
                    let mut buf = [0u8; 4096];
                    loop {
                        match err.read(&mut buf).await {
                            Ok(0) => break,
                            Ok(n) => {
                                let chunk = String::from_utf8_lossy(&buf[..n]);
                                session.output.lock().push_str(&chunk);
                            }
                            Err(_) => break,
                        }
                    }
                }
            });
        }

        self.sessions.lock().insert(id.clone(), session);
        Ok(json!({
            "terminalId": id,
            "pid": pid
        }))
    }

    pub fn output(&self, terminal_id: &str) -> Result<Value, AcpError> {
        let session = self
            .sessions
            .lock()
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| AcpError::Message(format!("unknown terminal {terminal_id}")))?;
        let output = session.output.lock().clone();
        let exit = *session.exit_code.lock();
        // Non-blocking poll for exit.
        {
            let mut child = session.child.lock();
            if let Ok(Some(status)) = child.try_wait() {
                *session.exit_code.lock() = status.code();
            }
        }
        let exit = exit.or_else(|| *session.exit_code.lock());
        Ok(json!({
            "output": output,
            "exitCode": exit,
            "truncated": false
        }))
    }

    pub async fn wait_for_exit(&self, terminal_id: &str) -> Result<Value, AcpError> {
        let session = self
            .sessions
            .lock()
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| AcpError::Message(format!("unknown terminal {terminal_id}")))?;

        let status = {
            // Poll without holding mutex across await.
            loop {
                {
                    let mut child = session.child.lock();
                    match child.try_wait() {
                        Ok(Some(status)) => break status,
                        Ok(None) => {}
                        Err(e) => {
                            return Err(AcpError::Message(format!("wait terminal: {e}")));
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        };
        let code = status.code();
        *session.exit_code.lock() = code;
        Ok(json!({
            "exitCode": code,
            "signal": null
        }))
    }

    pub async fn kill(&self, terminal_id: &str) -> Result<Value, AcpError> {
        let session = self
            .sessions
            .lock()
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| AcpError::Message(format!("unknown terminal {terminal_id}")))?;
        {
            let mut child = session.child.lock();
            let _ = child.start_kill();
        }
        if session.pid > 0 {
            let _ = std::process::Command::new("kill")
                .args(["-9", &session.pid.to_string()])
                .status();
        }
        for _ in 0..40 {
            {
                let mut child = session.child.lock();
                if let Ok(Some(status)) = child.try_wait() {
                    *session.exit_code.lock() = status.code();
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        Ok(json!({}))
    }

    pub async fn release(&self, terminal_id: &str) -> Result<Value, AcpError> {
        let _ = self.kill(terminal_id).await;
        self.sessions.lock().remove(terminal_id);
        Ok(json!({}))
    }

    pub async fn release_all(&self) {
        let ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for id in ids {
            let _ = self.release(&id).await;
        }
    }
}

/// Parse ACP create terminal params into (command, args).
pub fn parse_create_params(params: &Value) -> Result<(String, Vec<String>), AcpError> {
    // Common shapes:
    // { command: "ls", args: ["-la"] }
    // { command: ["ls", "-la"] }
    if let Some(arr) = params.get("command").and_then(|c| c.as_array()) {
        let mut iter = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string()));
        let cmd = iter
            .next()
            .ok_or_else(|| AcpError::Message("empty command array".into()))?;
        return Ok((cmd, iter.collect()));
    }
    let cmd = params
        .get("command")
        .and_then(|c| c.as_str())
        .ok_or_else(|| AcpError::Message("terminal create missing command".into()))?
        .to_string();
    let args = params
        .get("args")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    Ok((cmd, args))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn run_echo_and_release() {
        let host = TerminalHost::new();
        let ws = std::env::temp_dir();
        let created = host
            .create(&ws, "/bin/echo", &["hello-term".into()], &[])
            .await
            .unwrap();
        let id = created["terminalId"].as_str().unwrap().to_string();
        let wait = tokio::time::timeout(Duration::from_secs(5), host.wait_for_exit(&id))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(wait["exitCode"], 0);
        // Allow stdout reader task to flush into the buffer.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let out = host.output(&id).unwrap();
        let text = out["output"].as_str().unwrap_or("");
        assert!(
            text.contains("hello-term"),
            "expected echo output, got {text:?}"
        );
        host.release(&id).await.unwrap();
        assert!(host.output(&id).is_err());
    }

    #[tokio::test]
    async fn kill_cancels_sleep() {
        let host = TerminalHost::new();
        let ws = std::env::temp_dir();
        let created = host
            .create(&ws, "/bin/sleep", &["30".into()], &[])
            .await
            .unwrap();
        let id = created["terminalId"].as_str().unwrap().to_string();
        let pid = created["pid"].as_u64().unwrap() as u32;
        host.kill(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let alive = std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(!alive);
        host.release(&id).await.unwrap();
    }

    #[test]
    fn parse_command_array_not_shell() {
        let (cmd, args) =
            parse_create_params(&json!({"command": ["printf", "%s", "a b"]})).unwrap();
        assert_eq!(cmd, "printf");
        assert_eq!(args, vec!["%s", "a b"]);
    }
}
