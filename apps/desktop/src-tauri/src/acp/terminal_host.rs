//! Terminal host: spawn with argv arrays (never shell-concatenated).

use super::AcpError;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
#[cfg(not(unix))]
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use uuid::Uuid;

const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_COMMAND_DURATION: std::time::Duration = std::time::Duration::from_secs(30 * 60);

pub struct TerminalSession {
    pub id: String,
    pub child: Mutex<Child>,
    pub pid: u32,
    pub task_id: String,
    pub workspace: std::path::PathBuf,
    pub started_at: std::time::Instant,
    pub output: Mutex<String>,
    /// Absolute character range currently retained in `output`.
    pub output_range: Mutex<(usize, usize)>,
    pub exit_code: Mutex<Option<i32>>,
    pub truncated: Mutex<bool>,
    #[cfg(unix)]
    pub pty_writer: tokio::sync::Mutex<tokio::fs::File>,
}

#[derive(Default)]
pub struct TerminalHost {
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
}

impl TerminalHost {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn list(&self, task_id: Option<&str>) -> Value {
        let sessions = self.sessions.lock();
        let items = sessions
            .values()
            .filter(|session| task_id.is_none_or(|task_id| session.task_id == task_id))
            .map(|session| {
                json!({
                    "terminalId": session.id,
                    "taskId": session.task_id,
                    "workspaceRoot": session.workspace,
                    "pid": session.pid,
                    "exitCode": *session.exit_code.lock(),
                })
            })
            .collect::<Vec<_>>();
        json!(items)
    }

    /// Create a terminal running `command` with `args` (no shell).
    pub async fn create(
        &self,
        workspace: &Path,
        task_id: Option<&str>,
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
        let task_id = task_id.unwrap_or("unattributed").to_string();
        if self
            .sessions
            .lock()
            .values()
            .filter(|session| session.task_id == task_id)
            .count()
            >= 4
        {
            return Err(AcpError::Message(
                "task terminal limit exceeded (maximum 4)".into(),
            ));
        }

        #[cfg(unix)]
        let (master, slave) = open_pty(80, 24)?;
        let mut cmd = Command::new(command);
        cmd.args(args).current_dir(workspace).kill_on_drop(true);
        #[cfg(unix)]
        {
            use std::os::fd::{AsRawFd, FromRawFd};
            let slave_fd = slave.as_raw_fd();
            let stdin_fd = unsafe { libc::dup(slave_fd) };
            let stdout_fd = unsafe { libc::dup(slave_fd) };
            if stdin_fd < 0 || stdout_fd < 0 {
                return Err(AcpError::Message(format!(
                    "duplicate PTY slave failed: {}",
                    std::io::Error::last_os_error()
                )));
            }
            cmd.stdin(unsafe { Stdio::from_raw_fd(stdin_fd) })
                .stdout(unsafe { Stdio::from_raw_fd(stdout_fd) })
                .stderr(Stdio::from(slave));
            unsafe {
                cmd.pre_exec(move || {
                    if libc::setsid() < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    if libc::ioctl(slave_fd, libc::TIOCSCTTY as _, 0) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        #[cfg(not(unix))]
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (k, v) in env {
            cmd.env(k, v);
        }

        #[allow(unused_mut)]
        let mut child = cmd
            .spawn()
            .map_err(|e| AcpError::Message(format!("spawn terminal failed: {e}")))?;
        let pid = child.id().unwrap_or(0);
        let id = Uuid::new_v4().to_string();

        #[cfg(unix)]
        let master: std::fs::File = master.into();
        #[cfg(unix)]
        let reader = master
            .try_clone()
            .map_err(|error| AcpError::Message(error.to_string()))?;
        #[cfg(not(unix))]
        let stdout = child.stdout.take();
        #[cfg(not(unix))]
        let stderr = child.stderr.take();
        let session = Arc::new(TerminalSession {
            id: id.clone(),
            child: Mutex::new(child),
            pid,
            task_id,
            workspace: workspace.to_path_buf(),
            started_at: std::time::Instant::now(),
            output: Mutex::new(String::new()),
            output_range: Mutex::new((0, 0)),
            exit_code: Mutex::new(None),
            truncated: Mutex::new(false),
            #[cfg(unix)]
            pty_writer: tokio::sync::Mutex::new(tokio::fs::File::from_std(master)),
        });

        #[cfg(unix)]
        {
            let session = session.clone();
            // PTY masters are character devices. Reading them through
            // `tokio::fs::File` is unreliable on some macOS runner versions,
            // because that adapter is intended for regular files. Keep the
            // blocking read off the async runtime instead.
            tokio::task::spawn_blocking(move || {
                use std::io::Read;

                let mut out = reader;
                let mut buf = [0u8; 4096];
                loop {
                    match out.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => append_output(&session, &buf[..n]),
                        Err(_) => break,
                    }
                }
            });
        }
        #[cfg(not(unix))]
        spawn_pipe_reader(session.clone(), stdout);
        #[cfg(not(unix))]
        {
            spawn_pipe_reader(session.clone(), stderr);
        }

        self.sessions.lock().insert(id.clone(), session);
        if let Some(session) = self.sessions.lock().get(&id).cloned() {
            tokio::spawn(async move {
                tokio::time::sleep(MAX_COMMAND_DURATION).await;
                let running = session
                    .child
                    .lock()
                    .try_wait()
                    .map(|status| status.is_none())
                    .unwrap_or(false);
                if running {
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(-(session.pid as i32), libc::SIGKILL);
                    }
                    let _ = session.child.lock().start_kill();
                }
            });
        }
        Ok(json!({
            "terminalId": id,
            "pid": pid
        }))
    }

    pub fn output(&self, terminal_id: &str) -> Result<Value, AcpError> {
        self.output_page(terminal_id, 0, MAX_OUTPUT_BYTES)
    }

    pub fn output_page(
        &self,
        terminal_id: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Value, AcpError> {
        let session = self
            .sessions
            .lock()
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| AcpError::Message(format!("unknown terminal {terminal_id}")))?;
        let complete_output = session.output.lock().clone();
        let (start_offset, end_offset) = *session.output_range.lock();
        let relative_offset = offset.saturating_sub(start_offset);
        let output = complete_output
            .chars()
            .skip(relative_offset)
            .take(limit.clamp(1, 256 * 1024))
            .collect::<String>();
        let next_offset = start_offset
            .saturating_add(relative_offset)
            .saturating_add(output.chars().count())
            .min(end_offset);
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
            "truncated": *session.truncated.lock(),
            "nextOffset": next_offset,
            "hasMore": next_offset < end_offset,
            "startOffset": start_offset
        }))
    }

    #[cfg(unix)]
    pub async fn input(&self, terminal_id: &str, data: &str) -> Result<Value, AcpError> {
        use tokio::io::AsyncWriteExt;
        let session = self.session(terminal_id)?;
        session
            .pty_writer
            .lock()
            .await
            .write_all(data.as_bytes())
            .await
            .map_err(|error| AcpError::Message(format!("write terminal input: {error}")))?;
        Ok(json!({}))
    }

    #[cfg(unix)]
    pub fn resize(&self, terminal_id: &str, columns: u16, rows: u16) -> Result<Value, AcpError> {
        use std::os::fd::AsRawFd;
        let session = self.session(terminal_id)?;
        let writer = session
            .pty_writer
            .try_lock()
            .map_err(|_| AcpError::Message("terminal is busy".into()))?;
        set_pty_size(writer.as_raw_fd(), columns, rows)?;
        Ok(json!({}))
    }

    fn session(&self, terminal_id: &str) -> Result<Arc<TerminalSession>, AcpError> {
        self.sessions
            .lock()
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| AcpError::Message(format!("unknown terminal {terminal_id}")))
    }

    pub fn action_context(
        &self,
        terminal_id: &str,
    ) -> Result<(String, std::path::PathBuf), AcpError> {
        let session = self.session(terminal_id)?;
        Ok((session.task_id.clone(), session.workspace.clone()))
    }

    pub fn ports(&self, terminal_id: &str) -> Result<Value, AcpError> {
        let session = self.session(terminal_id)?;
        #[cfg(unix)]
        {
            let process_group = session.pid.to_string();
            let pids = std::process::Command::new("ps")
                .args(["-axo", "pid=,pgid="])
                .output()
                .ok()
                .filter(|output| output.status.success())
                .map(|output| {
                    String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .filter_map(|line| {
                            let mut fields = line.split_whitespace();
                            let pid = fields.next()?;
                            let pgid = fields.next()?;
                            (pgid == process_group).then_some(pid.to_string())
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![process_group]);
            let output = std::process::Command::new("lsof")
                .args(["-Pan", "-p", &pids.join(","), "-iTCP", "-sTCP:LISTEN"])
                .output();
            let ports = output
                .ok()
                .filter(|output| output.status.success())
                .map(|output| {
                    String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .skip(1)
                        .filter_map(|line| {
                            line.rsplit(':').next().and_then(|tail| {
                                tail.split_whitespace().next()?.parse::<u16>().ok()
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(json!({ "ports": ports }))
        }
        #[cfg(not(unix))]
        Ok(json!({ "ports": [] }))
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
        #[cfg(unix)]
        if session.pid > 0 {
            unsafe {
                libc::kill(-(session.pid as i32), libc::SIGKILL);
            }
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

    pub fn cancel_task(&self, task_id: &str) {
        let ids = self
            .sessions
            .lock()
            .iter()
            .filter_map(|(id, session)| (session.task_id == task_id).then_some(id.clone()))
            .collect::<Vec<_>>();
        for id in ids {
            if let Some(session) = self.sessions.lock().remove(&id) {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(session.pid as i32), libc::SIGKILL);
                }
                let _ = session.child.lock().start_kill();
            }
        }
    }
}

fn append_output(session: &TerminalSession, bytes: &[u8]) {
    let chunk = String::from_utf8_lossy(bytes);
    let appended_chars = chunk.chars().count();
    let mut output = session.output.lock();
    let mut range = session.output_range.lock();
    output.push_str(&chunk);
    range.1 = range.1.saturating_add(appended_chars);
    if output.len() > MAX_OUTPUT_BYTES {
        let excess = output.len() - MAX_OUTPUT_BYTES;
        let boundary = output
            .char_indices()
            .find_map(|(index, _)| (index >= excess).then_some(index))
            .unwrap_or(output.len());
        let drained_chars = output[..boundary].chars().count();
        output.drain(..boundary);
        range.0 = range.0.saturating_add(drained_chars);
        *session.truncated.lock() = true;
    }
}

#[cfg(not(unix))]
fn spawn_pipe_reader<R>(session: Arc<TerminalSession>, stream: Option<R>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        if let Some(mut stream) = stream {
            let mut buffer = [0_u8; 4096];
            loop {
                match stream.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(read) => append_output(&session, &buffer[..read]),
                    Err(_) => break,
                }
            }
        }
    });
}

#[cfg(unix)]
fn open_pty(
    columns: u16,
    rows: u16,
) -> Result<(std::os::fd::OwnedFd, std::os::fd::OwnedFd), AcpError> {
    use std::os::fd::FromRawFd;
    let mut master = -1;
    let mut slave = -1;
    let mut size = libc::winsize {
        ws_row: rows,
        ws_col: columns,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let result = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if result != 0 {
        return Err(AcpError::Message(format!(
            "open PTY failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(unsafe {
        (
            std::os::fd::OwnedFd::from_raw_fd(master),
            std::os::fd::OwnedFd::from_raw_fd(slave),
        )
    })
}

#[cfg(unix)]
fn set_pty_size(fd: std::os::fd::RawFd, columns: u16, rows: u16) -> Result<(), AcpError> {
    if columns == 0 || rows == 0 {
        return Err(AcpError::Message("terminal size must be positive".into()));
    }
    let size = libc::winsize {
        ws_row: rows,
        ws_col: columns,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let result = unsafe { libc::ioctl(fd, libc::TIOCSWINSZ as _, &size) };
    if result != 0 {
        return Err(AcpError::Message(format!(
            "resize PTY failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
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
    let command_line = params
        .get("command")
        .and_then(|c| c.as_str())
        .ok_or_else(|| AcpError::Message("terminal create missing command".into()))?;
    let explicit_args: Option<Vec<String>> =
        params.get("args").and_then(|a| a.as_array()).map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        });
    if let Some(args) = explicit_args {
        if !args.is_empty() || !command_line.chars().any(char::is_whitespace) {
            return Ok((command_line.to_string(), args));
        }
    }
    let mut argv = split_command_line(command_line)?;
    if argv.is_empty() {
        return Err(AcpError::Message("empty terminal command".into()));
    }
    let command = argv.remove(0);
    Ok((command, argv))
}

/// Parse a command line into argv without invoking a shell or performing any
/// expansion. ACP agents commonly send `command: "npm test"`; treating that
/// entire string as a program path produces ENOENT. Shell control operators
/// remain forbidden and must be requested as explicit interpreter argv, where
/// the policy engine can require confirmation.
fn split_command_line(input: &str) -> Result<Vec<String>, AcpError> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Quote {
        None,
        Single,
        Double,
    }

    let mut quote = Quote::None;
    let mut escaped = false;
    let mut current = String::new();
    let mut argv = Vec::new();
    for character in input.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        match (quote, character) {
            (Quote::None, '\\') | (Quote::Double, '\\') => escaped = true,
            (Quote::None, '\'') => quote = Quote::Single,
            (Quote::Single, '\'') => quote = Quote::None,
            (Quote::None, '"') => quote = Quote::Double,
            (Quote::Double, '"') => quote = Quote::None,
            (Quote::None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    argv.push(std::mem::take(&mut current));
                }
            }
            (Quote::None, '|' | ';' | '&' | '<' | '>' | '`' | '\n' | '\r') => {
                return Err(AcpError::Message(
                    "terminal command contains a shell control operator".into(),
                ));
            }
            (_, c) => current.push(c),
        }
    }
    if escaped || quote != Quote::None {
        return Err(AcpError::Message(
            "terminal command contains an unfinished quote or escape".into(),
        ));
    }
    if !current.is_empty() {
        argv.push(current);
    }
    Ok(argv)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parses_string_command_line_to_argv_without_a_shell() {
        let (command, args) = parse_create_params(&serde_json::json!({
            "command": "npm test -- --test-name-pattern 'handles empty'"
        }))
        .unwrap();
        assert_eq!(command, "npm");
        assert_eq!(
            args,
            vec!["test", "--", "--test-name-pattern", "handles empty"]
        );
    }

    #[test]
    fn rejects_shell_operators_in_string_command_line() {
        assert!(parse_create_params(&serde_json::json!({
            "command": "npm test | tee result.txt"
        }))
        .is_err());
        assert!(parse_create_params(&serde_json::json!({
            "command": "echo 'unfinished"
        }))
        .is_err());
    }

    #[tokio::test]
    async fn run_echo_and_release() {
        let host = TerminalHost::new();
        let ws = std::env::temp_dir();
        #[cfg(target_os = "windows")]
        let (command, args) = (
            "cmd.exe",
            vec!["/C".into(), "echo".into(), "hello-term".into()],
        );
        #[cfg(not(target_os = "windows"))]
        let (command, args) = ("/bin/echo", vec!["hello-term".into()]);
        let created = host.create(&ws, None, command, &args, &[]).await.unwrap();
        let id = created["terminalId"].as_str().unwrap().to_string();
        let wait = tokio::time::timeout(Duration::from_secs(5), host.wait_for_exit(&id))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(wait["exitCode"], 0);
        // Process exit and the asynchronous PTY reader are independent. Poll
        // for the expected output instead of assuming a fixed scheduler delay.
        let text = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let out = host.output(&id).unwrap();
                let text = out["output"].as_str().unwrap_or("").to_string();
                if text.contains("hello-term") {
                    break text;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("PTY reader did not flush echo output before the deadline");
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
        #[cfg(target_os = "windows")]
        let (command, args) = (
            "powershell.exe",
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                "Start-Sleep -Seconds 30".into(),
            ],
        );
        #[cfg(not(target_os = "windows"))]
        let (command, args) = ("/bin/sleep", vec!["30".into()]);
        let created = host.create(&ws, None, command, &args, &[]).await.unwrap();
        let id = created["terminalId"].as_str().unwrap().to_string();
        #[cfg(unix)]
        let pid = created["pid"].as_u64().unwrap() as u32;
        host.kill(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        #[cfg(unix)]
        {
            let alive = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            assert!(!alive);
        }
        #[cfg(target_os = "windows")]
        assert!(host.output(&id).is_ok());
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
