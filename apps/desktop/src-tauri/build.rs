fn main() {
    println!("cargo:rerun-if-env-changed=APPLE_TEAM_ID");
    println!("cargo:rerun-if-changed=../../../harness");
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
    // Stage harness next to externalBin for agent-host process discovery
    // (MacOS/harness alongside the sidecar). Tauri also bundles Resources/harness.
    stage_harness_for_sidecar();
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

fn stage_harness_for_sidecar() {
    let source = std::path::Path::new("../../../harness");
    if !source.join("plugin.json").is_file() {
        return;
    }
    let dest = std::path::Path::new("binaries/harness");
    let _ = std::fs::remove_dir_all(dest);
    if let Err(error) = copy_dir_all(source, dest) {
        // Non-fatal for `cargo test` when the monorepo layout is unavailable.
        println!("cargo:warning=failed to stage harness plugin: {error}");
    }
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if ty.is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
