# Privacy

Grok Build Desktop has no product analytics or telemetry. Workspaces, transcripts, events, diffs, artifacts, and audit records remain on the local Mac unless the user explicitly invokes a networked Runtime, MCP server, or external tool. Prompts sent through the official Grok Build CLI are intentionally transmitted to that configured runtime.

API credentials are stored in macOS Keychain. Diagnostic bundles are redacted and must be previewed before export. The application does not operate a cloud service and does not collect user code.

## Privacy layers (defaults)

New installations enable three complementary privacy controls by default:

| Control | Scope | Default | Effect |
|---------|--------|---------|--------|
| **Privacy Mode** | Grok / xAI account | **On** | Coding session data is not used to train or improve the product (`/privacy opt-out` / `codingDataRetentionOptOut`) |
| **Private Chat** | This desktop app | **On** | Task history, drafts, and transcript cache stay out of local durable storage |
| **Privacy Shield (Strict)** | Local outbound prompts | **On** | Redact common secrets and block high-risk attachment names before send |

### Grok Privacy Mode (account-level)

**Privacy Mode** is enabled by default for the desktop app preference. When an agent is connected and you are signed in, the app applies that preference through the Grok Build agent method `x.ai/privacy/setCodingDataRetention`, matching CLI:

```text
/privacy opt-out   # Privacy Mode on — code data not used for training
/privacy opt-in    # share coding data for product improvement
```

This is the same control as Grok Build settings “Coding data sharing”. It requires authentication. Enterprise **Zero Data Retention (ZDR)** may force privacy on and lock the control; the desktop app will not claim success if the agent reports that the setting cannot change.

The desktop stores your desired Privacy Mode flag locally and re-applies it when an agent becomes ready. If no agent is running, the preference is kept and synced on the next successful connection.

### Local Private Chat

**Private Chat** is enabled by default for new desktop tasks. While it is on, the desktop app keeps the task only in memory and does not write its session row, draft, cached transcript events, task contract, context manifests, verification records, or transcript export to this application's local history. A private task is therefore not restored when the desktop app restarts.

This is a desktop-local retention control. It does not replace account-level Privacy Mode above.

### Local Privacy Shield

New installations use **Strict Privacy Shield** by default. Strict mode protects outgoing prompt content and, in the current desktop flow:

- detects and replaces common API-key, access-token, JWT, and PEM private-key patterns in prompt text and text attachments;
- blocks attachments with high-risk names such as `.env`, private SSH key names, credential files, and key-container extensions;
- records and sends the reviewed redacted prompt rather than the detected raw prompt text; and
- applies the same guardrail in the local Agent Host, so an older renderer cannot bypass it accidentally.

The detection is deliberately narrow and local. It is **not** a data-loss-prevention system: it cannot reliably read secrets embedded in images, PDFs, encrypted/binary files, obfuscated strings, tool output, or content a user deliberately chooses to send in **Standard** mode. Review every prompt and attachment before sending.

## Grok / xAI boundary

Account-level retention and training are controlled by **Privacy Mode** (this app + Grok Build `/privacy`) and any enterprise ZDR or team admin policy. Configure additional account choices using xAI's [Consumer FAQ](https://x.ai/legal/faq), [Privacy Policy](https://x.ai/legal/privacy-policy), and [privacy request portal](https://accounts.x.ai/privacy).

Grok Build CLI and configured MCP servers have their own privacy terms and network behavior. The permission UI identifies externally visible actions when the platform can observe them.
