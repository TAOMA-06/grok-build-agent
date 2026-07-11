# Security Policy

## Supported versions

Security fixes are provided for the latest signed macOS release. Development snapshots are not supported releases.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving command execution, path isolation, credentials, IPC authentication, permission bypass, or data exfiltration. Use GitHub private vulnerability reporting for this repository and include reproduction steps, affected version, and impact. Maintainers will acknowledge a complete report within seven days.

## Security boundaries

- The Renderer is untrusted and cannot directly run commands, write files, access Git credentials, or read Keychain values.
- The Agent Host accepts same-user, authenticated, versioned local RPC only.
- Secrets remain in macOS Keychain and are redacted from events and diagnostic exports.
- Workspace access and high-risk actions are fail-closed.

No security guarantee is made for user-installed MCP servers, plugins, Skills, or the external Grok CLI itself.
