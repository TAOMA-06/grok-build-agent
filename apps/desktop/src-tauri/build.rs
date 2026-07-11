fn main() {
    println!("cargo:rerun-if-env-changed=APPLE_TEAM_ID");
    // Tauri validates externalBin paths even for `cargo test`, before the
    // release hook has built the real sidecar. Keep a disposable placeholder
    // out of git; `prepare-sidecar.mjs` replaces it before every bundle.
    let target = std::env::var("TARGET")
        .or_else(|_| std::env::var("TAURI_ENV_TARGET_TRIPLE"))
        .unwrap_or_else(|_| "aarch64-apple-darwin".into());
    let sidecar =
        std::path::PathBuf::from("binaries").join(format!("grok-build-agent-host-{target}"));
    if !sidecar.exists() {
        if let Some(parent) = sidecar.parent() {
            std::fs::create_dir_all(parent).expect("create sidecar staging directory");
        }
        std::fs::write(&sidecar, []).expect("create sidecar validation placeholder");
    }
    let entitlements = std::path::Path::new("entitlements.generated.plist");
    if !entitlements.exists() {
        std::fs::write(
            entitlements,
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict/></plist>\n",
        )
        .expect("create generated entitlements placeholder");
    }
    tauri_build::build()
}
