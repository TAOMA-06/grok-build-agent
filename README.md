# Grok Build Desktop

**Downloadable desktop agent** for [Grok Build](https://x.ai) — product shape inspired by [Hermes-CN-Desktop](https://github.com/Eynzof/Hermes-CN-Desktop) (onboarding, runtime health, workbench), protocol stack built for **Grok ACP** (`grok agent stdio`).

You install a normal macOS app (`.dmg` → drag to Applications).  
First launch runs a **setup wizard** (detect `grok`, auth, workspace). The agent engine remains **Grok Build CLI**; this app is the shell.

---

## Download (end users)

### Option A — GitHub Releases (recommended)

1. Open **[Releases](../../releases)** on this repository  
2. Download **`Grok Build Desktop_*.dmg`** (macOS)  
3. Open the DMG → drag **Grok Build Desktop** into **Applications**  
4. First launch (unsigned community builds):
   - Right-click the app → **Open** → confirm, **or**
   - Terminal:  
     `xattr -dr com.apple.quarantine "/Applications/Grok Build Desktop.app"`

### Option B — Build a local installer on your Mac

```bash
git clone <this-repo> grok-build-desktop
cd grok-build-desktop
./scripts/build-macos.sh
```

Artifacts land in:

- `dist/release/*.dmg` — installer image  
- `apps/desktop/src-tauri/target/release/bundle/macos/*.app` — app bundle  

Double-click the `.dmg`, install, done.

> **Signing / notarization:** community builds are unsigned by default. For public distribution without Gatekeeper friction, configure Apple Developer signing + notarization (see Tauri docs). CI can be extended later with secrets.

---

## Requirements (still needed after install)

The desktop app is a **shell**. You also need:

| Dependency | Why |
|------------|-----|
| **Grok Build CLI** (`grok`) | Real agent runtime |
| Auth | `grok login` or `XAI_API_KEY` |

Typical binary path: `~/.grok/bin/grok`

```bash
grok --version
grok login   # or export XAI_API_KEY=...
```

In the app: **Settings** → optional custom path to `grok` → **Open workspace** → **Connect**.

---

## What you get

| Layer | Role |
|-------|------|
| **Desktop app** | Installable UI: onboarding, workbench, chat, thoughts, tools, plan/tasks panels, runtime health, permissions |
| **Runtime manager** | Probe `grok`, auth checklist, restart agent, persisted settings |
| **ACP host** | Manages `grok agent stdio` (not Hermes Gateway — different engine) |
| **Grok Build** | Models, tools, MCP, subagents, skills |
| **`harness/`** | Orchestrator rules so the agent actually uses plan + parallel workers |

See [docs/product-parity-hermes.md](docs/product-parity-hermes.md) for the Hermes → Grok mapping.

---

## For developers

```bash
cd apps/desktop
npm install
npm run app:dev      # development
npm run app:build    # production .app + .dmg
```

Publish a version:

```bash
git tag v0.1.0
git push origin v0.1.0
# GitHub Actions builds macOS artifacts and attaches them to the Release
```

### Layout

```
apps/desktop/     Tauri app (what users download)
harness/          Optional Grok plugin / rules pack
scripts/          build-macos.sh
.github/workflows release.yml
docs/             architecture notes
```

More: [docs/architecture.md](docs/architecture.md) · [docs/harness.md](docs/harness.md)

---

## Security

- Tool runs may require an **Allow** prompt (unless Always-approve is on)  
- Always-approve = yolo — only on trusted machines/repos  
- No API keys are baked into the app; auth stays with local `grok`

---

## Roadmap

- [x] Installable macOS `.app` / `.dmg`  
- [x] GitHub Actions release workflow  
- [x] ACP chat + tools + permissions + harness  
- [ ] Apple notarized releases  
- [ ] Plan approve UI, Tasks, Diff panels  
- [ ] Windows / Linux installers  

---

## License

MIT — see [LICENSE](LICENSE).

**Disclaimer:** Unofficial community project. Not affiliated with xAI.
