# Privacy

Grok Build Desktop has no product analytics or telemetry. Workspaces, transcripts, events, diffs, artifacts, and audit records remain on the local Mac unless the user explicitly invokes a networked Runtime, MCP server, or external tool. Prompts sent through the official Grok Build CLI are intentionally transmitted to that configured runtime.

API credentials are stored in macOS Keychain. Diagnostic bundles are redacted and must be previewed before export. The application does not operate a cloud service and does not collect user code.

## Local Privacy Shield

New installations use **Strict Privacy Shield** by default. Strict mode protects outgoing prompt content and, in the current desktop flow:

- detects and replaces common API-key, access-token, JWT, and PEM private-key patterns in prompt text and text attachments;
- blocks attachments with high-risk names such as `.env`, private SSH key names, credential files, and key-container extensions;
- records and sends the reviewed redacted prompt rather than the detected raw prompt text; and
- applies the same guardrail in the local Agent Host, so an older renderer cannot bypass it accidentally.

The detection is deliberately narrow and local. It is **not** a data-loss-prevention system: it cannot reliably read secrets embedded in images, PDFs, encrypted/binary files, obfuscated strings, tool output, or content a user deliberately chooses to send in **Standard** mode. Review every prompt and attachment before sending.

## Grok / xAI boundary

This project cannot change the privacy, retention, training, or account controls of the upstream Grok/xAI service. Strict Privacy Shield is a local desktop safeguard, not an xAI privacy setting. Configure any account-level choices separately using xAI's [Consumer FAQ](https://x.ai/legal/faq), [Privacy Policy](https://x.ai/legal/privacy-policy), and [privacy request portal](https://accounts.x.ai/privacy).

Grok Build CLI and configured MCP servers have their own privacy terms and network behavior. The permission UI identifies externally visible actions when the platform can observe them.
