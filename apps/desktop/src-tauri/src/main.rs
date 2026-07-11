// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.iter().any(|argument| argument == "--agent-host") {
        if let Err(error) = grok_build_desktop_lib::agent_host::run_blocking() {
            eprintln!("Agent Host failed: {error}");
            std::process::exit(1);
        }
    } else if arguments
        .iter()
        .any(|argument| argument == "--install-agent-host")
    {
        if let Err(error) = grok_build_desktop_lib::launch_agent::ensure_running() {
            eprintln!("Agent Host installation failed: {error}");
            std::process::exit(1);
        }
    } else if arguments
        .iter()
        .any(|argument| argument == "--restart-agent-host")
    {
        if let Err(error) = grok_build_desktop_lib::launch_agent::restart() {
            eprintln!("Agent Host restart failed: {error}");
            std::process::exit(1);
        }
    } else if arguments
        .iter()
        .any(|argument| argument == "--uninstall-agent-host")
    {
        if let Err(error) = grok_build_desktop_lib::launch_agent::uninstall() {
            eprintln!("Agent Host uninstallation failed: {error}");
            std::process::exit(1);
        }
    } else if arguments.iter().any(|argument| argument == "--doctor-json") {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("Doctor runtime failed: {error}");
                std::process::exit(1);
            }
        };
        let result = runtime.block_on(async {
            let client = grok_build_desktop_lib::host_client::HostClient::load_default()
                .map_err(|error| error.to_string())?;
            let second = grok_build_desktop_lib::host_client::HostClient::load_default()
                .map_err(|error| error.to_string())?;
            let keychain_stable = client.token_fingerprint() == second.token_fingerprint();
            let host = client.health().await;
            let runtime = client
                .request(
                    "runtime.health",
                    serde_json::json!({ "grokPath": null }),
                    None,
                )
                .await;
            Ok::<_, String>(serde_json::json!({
                "keychainStable": keychain_stable,
                "host": host.map_err(|error| error.to_string()),
                "runtime": runtime.map_err(|error| error.to_string()),
            }))
        });
        match result {
            Ok(report) => println!("{report}"),
            Err(error) => {
                eprintln!("Doctor failed: {error}");
                std::process::exit(1);
            }
        }
    } else {
        grok_build_desktop_lib::run()
    }
}
