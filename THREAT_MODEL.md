# Threat Model

## Protected assets

Source code, workspace files, credentials, Git state, transcripts, local audit history, and the authority to run commands or access networks.

## Trust boundaries

- The React Renderer is untrusted.
- The Tauri process is a narrow UI broker.
- The Agent Host is the local policy and execution boundary.
- Grok CLI, repository content, web content, MCP servers, plugins, and Skills are untrusted inputs.

## Primary threats

Permission bypass, forged local IPC, replayed writes, prompt injection, workspace path escape, symlink/hard-link replacement, destructive Git, secret leakage, unauthorized network access, orphan processes, and duplicate Prompt execution after crashes.

## Required mitigations

Same-UID Unix socket checks, Keychain token authentication, protocol versioning, idempotency keys, append-only events, canonical path checks, atomic writes, risk classification, explicit confirmation, output limits, redaction, worktree isolation, and crash-recovery tests.

Strict network isolation is not claimed for Grok v1 because the Runtime does not provide verifiable attestation. The corresponding UI mode is disabled.
