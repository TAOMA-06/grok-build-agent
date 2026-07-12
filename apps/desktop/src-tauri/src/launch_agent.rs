//! Install/wake the per-user macOS Agent Host without shell command construction.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use thiserror::Error;

const LABEL: &str = "com.grokbuilddesktop.community.agent-host";
static ENSURE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Error)]
pub enum LaunchAgentError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn ensure_running() -> Result<(), LaunchAgentError> {
    // React StrictMode and multiple windows can ask the broker to ensure the Host
    // concurrently. Serialize the full readiness sequence so a second caller
    // observes the live socket instead of restarting the process that the first
    // caller is still waiting for.
    let _guard = ENSURE_LOCK
        .lock()
        .map_err(|_| LaunchAgentError::Message("Agent Host launch lock is poisoned".into()))?;
    ensure_running_locked()
}

fn ensure_running_locked() -> Result<(), LaunchAgentError> {
    let socket = crate::agent_host::socket_path()
        .map_err(|error| LaunchAgentError::Message(error.to_string()))?;
    if socket_is_live(&socket) {
        return Ok(());
    }
    let executable = std::env::current_exe()?;
    #[cfg(target_os = "macos")]
    {
        let host_executable = host_executable(&executable)?;
        install_and_kickstart(&host_executable)?;
    }
    #[cfg(not(target_os = "macos"))]
    spawn_for_development(&executable)?;

    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if socket_is_live(&socket) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(LaunchAgentError::Message(
        "Agent Host did not become ready within 15 seconds".into(),
    ))
}

pub fn restart() -> Result<(), LaunchAgentError> {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: geteuid has no preconditions.
        let uid = unsafe { libc::geteuid() };
        let target = format!("gui/{uid}/{LABEL}");
        let _ = Command::new("launchctl")
            .args(["bootout", &target])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let socket = crate::agent_host::socket_path()
            .map_err(|error| LaunchAgentError::Message(error.to_string()))?;
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && socket_is_live(&socket) {
            std::thread::sleep(Duration::from_millis(50));
        }
        if socket.exists() && !socket_is_live(&socket) {
            let _ = std::fs::remove_file(socket);
        }
        ensure_running()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(LaunchAgentError::Message(
            "Agent Host restart is supported only on macOS v1".into(),
        ))
    }
}

pub fn uninstall() -> Result<(), LaunchAgentError> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| LaunchAgentError::Message("HOME is unavailable".into()))?;
        // SAFETY: geteuid has no preconditions.
        let uid = unsafe { libc::geteuid() };
        let target = format!("gui/{uid}/{LABEL}");
        let _ = Command::new("launchctl")
            .args(["bootout", &target])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let plist = home
            .join("Library/LaunchAgents")
            .join(format!("{LABEL}.plist"));
        if plist.exists() {
            std::fs::remove_file(plist)?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

fn socket_is_live(path: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::net::UnixStream::connect(path).is_ok()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

#[cfg(target_os = "macos")]
fn host_executable(ui_executable: &Path) -> Result<PathBuf, LaunchAgentError> {
    if cfg!(debug_assertions) && std::env::var("GROK_BUILD_IN_PROCESS_HOST").as_deref() == Ok("1") {
        return Ok(ui_executable.to_path_buf());
    }
    let host = ui_executable
        .parent()
        .ok_or_else(|| LaunchAgentError::Message("UI executable directory is unavailable".into()))?
        .join("grok-build-agent-host");
    if !host.is_file() {
        return Err(LaunchAgentError::Message(format!(
            "independent Agent Host is missing at {}",
            host.display()
        )));
    }
    Ok(host)
}

#[cfg(target_os = "macos")]
fn install_and_kickstart(executable: &Path) -> Result<(), LaunchAgentError> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| LaunchAgentError::Message("HOME is unavailable".into()))?;
    let directory = home.join("Library/LaunchAgents");
    std::fs::create_dir_all(&directory)?;
    let plist = directory.join(format!("{LABEL}.plist"));
    let content = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
         <key>Label</key><string>{LABEL}</string>\n\
         <key>ProgramArguments</key><array><string>{}</string><string>--agent-host</string></array>\n\
         <key>EnvironmentVariables</key><dict>\n\
           <key>HOME</key><string>{}</string>\n\
           <key>PATH</key><string>{}/.grok/bin:{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>\n\
         </dict>\n\
         <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n\
         </dict></plist>\n",
        xml_escape(&executable.to_string_lossy()),
        xml_escape(&home.to_string_lossy()),
        xml_escape(&home.to_string_lossy()),
        xml_escape(&home.to_string_lossy())
    );
    // SAFETY: geteuid has no preconditions.
    let uid = unsafe { libc::geteuid() };
    let domain = format!("gui/{uid}");
    let target = format!("{domain}/{LABEL}");
    let changed = std::fs::read_to_string(&plist)
        .map(|existing| existing != content)
        .unwrap_or(true);
    if changed {
        let _ = Command::new("launchctl")
            .args(["bootout", &target])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let temp = directory.join(format!(".{LABEL}.{}.tmp", std::process::id()));
        {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
        }
        std::fs::rename(&temp, &plist)?;
        std::fs::File::open(&directory)?.sync_all()?;
    }
    let _ = Command::new("launchctl")
        .args(["bootstrap", &domain, plist.to_string_lossy().as_ref()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let status = Command::new("launchctl")
        .args(["kickstart", "-k", &target])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()?;
    if !status.success() {
        return Err(LaunchAgentError::Message(
            "launchctl could not start Agent Host".into(),
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn spawn_for_development(executable: &Path) -> Result<(), LaunchAgentError> {
    Command::new(executable)
        .arg("--agent-host")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
