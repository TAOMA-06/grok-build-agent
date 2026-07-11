fn main() {
    if let Err(error) = grok_build_desktop_lib::agent_host::run_blocking() {
        eprintln!("Agent Host failed: {error}");
        std::process::exit(1);
    }
}
