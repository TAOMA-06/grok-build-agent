# Product charter: evidence-first coding workbench for Grok Build

Date: 2026-09-03
Decision owner: Product owner
Working product label: **TBD — coding workbench for Grok Build**
Repository label during transition: `grok-build-agent`

## Decision

Build a focused, local-first macOS product for professional developers who want Grok's coding ability but need stronger control over how code changes are planned, executed, reviewed, verified, recovered, and delivered.

This is not a new model, a new agent loop, or a terminal skin. The official Grok Build CLI remains the runtime. The product is the code-delivery control plane around it.

## Product statement

> Turn a coding intention into an isolated, reviewable, independently verified change set, with a durable record of what Grok did, what actually passed, and what still blocks delivery.

The north-star outcome is not “the assistant replied.” It is:

> A developer can decide within 30 seconds whether a Grok task is safe to apply, what evidence supports that decision, and what remains unverified.

## Target user

Primary user:

- a macOS developer, technical founder, or repository owner;
- uses or wants to use the official Grok Build CLI for multi-file coding tasks;
- delegates long-running implementation, refactor, debugging, review, or test work;
- values speed, but will not accept silent writes, ambiguous completion, lost work, or unverifiable “done” claims.

The first release is not optimized for people seeking a general desktop chatbot or a no-code assistant.

## Jobs to be done

1. Start a coding task without endangering a dirty main checkout.
2. Understand which repository, worktree, base commit, model, reasoning level, permissions, and Grok version own the run.
3. Let Grok plan, implement, run tools, and use subagents while retaining explicit human authority at meaningful boundaries.
4. Inspect every changed file, command, failure, permission, test, and unresolved issue in one place.
5. Run review and verification independently from the implementation claim.
6. Recover after UI, Host, Grok, or machine interruption without duplicating prompts or side effects.
7. Apply or reject the result through a preflight that cannot silently overwrite unrelated user work.
8. Export a trustworthy execution receipt for later review or handoff.

## Product pillars

### 1. Grok compatibility gate

- Record the installed CLI version, ACP version, agent version, model catalog, reasoning levels, capability flags, and private-extension methods observed for each task.
- Enable controls from live capabilities, not version guesses or hard-coded catalogs.
- Support an explicit range: latest official stable and the immediately previous stable at release time.
- Fail closed for unknown or missing capabilities that can write, restore, apply, publish, or bypass approval.
- Track official stable releases and a specific public `xai-org/grok-build` source commit separately. The periodically synced source may lead or lag stable and never substitutes for the installed runtime contract.
- Full write-capable support is limited to the release-frozen latest and immediately previous stable. Older or unknown versions receive diagnostics/read-only access or an explicit block; the product never silently upgrades the user's global CLI.

### 2. Safe worktree delivery

- Every write-capable coding task starts in a managed worktree outside the source checkout.
- Plan runs under an additional Host-enforced read-only policy; the product does not rely on Grok Plan alone because the official mode still permits shell and child-agent write paths.
- Apply is a separate operation: freeze source/destination identity, preview, validate conflicts, bind a recovery checkpoint, repeat preflight, then write.
- The UI states filesystem isolation and network isolation separately. On macOS, the product must not claim enforced child-network isolation when Grok cannot prove it.

### 3. Independent review and verification

- Implementation response, code written, automated checks passed, review passed, and safe-to-apply are separate states.
- The implementing run cannot manufacture its own release evidence.
- Review is bound to a frozen base SHA and diff hash.
- Verification is bound to execution root, command argv, environment class, start/end time, exit code, and artifact hashes.
- Failed, skipped, unavailable, and not-run checks remain visibly distinct.

### 4. Durable supervision and recovery

- The local Agent Host, not the renderer window, owns runtime lifecycle and durable task state.
- Accepted messages are never silently dropped; uncertain delivery is never automatically replayed when the runtime lacks idempotency.
- Stop, reload, and recovery are scoped to the exact task/connection/process group.
- Multi-project status shows working, waiting, failed, verifying, ready-to-review, and blocked without requiring the user to open every conversation.

### 5. Execution receipt

Every modified task can export Markdown and JSON containing:

- product commit and version;
- official Grok CLI/ACP/agent version;
- model and reasoning effort;
- workspace identity, execution root, base SHA, head SHA, and diff hash;
- task constraints and allowed paths;
- prompts accepted and delivery state;
- permissions and policy decisions;
- changed files and review findings;
- verification commands, exit codes, logs/artifact hashes, and timestamps;
- unresolved risks, skipped gates, and final disposition.

Receipts are potential disclosure artifacts. Export therefore requires a preview and explicit confirmation; defaults redact secrets, personal paths, prompt bodies, raw logs, and sensitive tool parameters. An export records hashes or bounded summaries where full content is unnecessary and runs a final secret scan before it is written.

## Ownership boundary

| Capability | Official Grok Build owns | Desktop product owns |
| --- | --- | --- |
| Authentication | Login, refresh, account and API-key runtime behavior | Guided launch/handoff, health display; never stores or prints raw tokens |
| Models | Live model catalog and model execution | Capability-driven picker and per-task receipt |
| Agent loop | Reasoning, tool selection, subagents, workflows, compaction | Task contract, execution policy, supervision, evidence projection |
| Tools/extensions | Built-in tools, Skills, Plugins, Hooks, MCP, LSP | Read-only discovery and approved official CLI operations relevant to code delivery |
| Sessions | Remote/session runtime and ACP session identity | Project/task mapping, local durable projection, delivery journal, review/verify state |
| Worktrees | Grok may expose worktree features | Desktop owns its task worktree; it launches Grok in that cwd and avoids nested ownership |
| Permissions | Runtime-provided choices and tool metadata | Hard deny/confirm policy, scope checks, audit, exact response routing |
| Code review | Grok can perform review reasoning | Frozen diff, independent reviewer run, finding disposition, apply preflight |
| Verification | Grok can run commands | Declaration, execution receipt, provenance binding, completion gate |
| Distribution | Official CLI installer/updater | Desktop signing, notarization, updater, release evidence |

## First-release scope

- macOS 12 or later, with Apple Silicon and Intel as release requirements rather than compilation-only intent. The oldest supported macOS and a real Intel Mac require installed-app evidence.
- Official stable Grok Build CLI installed separately; the desktop does not fork, bundle, replace, or emulate it.
- Official Grok authentication and official Grok model paths. The first release does not manage custom providers; a discovered non-Grok/custom model is not run automatically.
- Project/task navigation and durable Agent Host.
- Managed external worktrees, dirty-source handling, diff/hunk review, checkpoints, and safe Apply.
- Agent, Plan, and explicit approval modes driven by actual runtime capabilities.
- Tool, permission, subagent, background-task, failure, and context timeline.
- Independent Review and Verify stages.
- Execution receipt.
- Diagnostics and stable-version compatibility receipt.
- Signed, notarized, stapled universal desktop artifact with an independently verified download/install path.

## Explicit first-release non-goals

- General multi-provider Agent or provider aggregation.
- A custom model gateway or in-house agent loop.
- Full IDE, code completion, debugger, or LSP editor replacement.
- Generic chat, image/video generation, voice mode, or desktop Computer Use.
- Phone/remote control, cloud machines, team sync, or multi-tenant hosting.
- Scheduled automation or Marketplace operation.
- Rebuilding every official Grok Dashboard, Session, Workflow, Plugin, or Settings surface.
- Marketing “sandbox enabled” as network isolation on macOS.
- Publishing under the name `Grok Build Desktop`.

The app may expose an “Open in Xcode/Cursor/VS Code” action; it does not compete with those editors.

## Differentiation test

The product is worth continuing only if the vertical slice proves both:

1. On the first paired ten-task slice, each task runs three times per surface from the same repository snapshot. Desktop succeeds on at least 27/30 and does not record more than three additional failed runs versus the same official CLI/model/effort baseline. A percentage-point non-inferiority claim requires a larger later sample.
2. It materially improves completion judgment. For the same blinded task receipts, time starts when the result is presented and stops when the operator correctly identifies changed scope, failed/not-run checks, and remaining blockers; target median time is at least 20% below the official CLI baseline without lower answer accuracy.

If the product cannot pass this test, adding more generic GUI features is not a valid response.

## Product success measures

Proposed release thresholds are defined in the delivery plan. The product-level measures are:

- zero unapproved protected-path writes in the safety corpus;
- zero false `Verified` or `Ready to apply` states when a required check failed, was skipped, or was not run;
- zero duplicate side effects across the crash/retry corpus;
- 100% task receipt coverage for write-capable tasks;
- the latest and immediately previous official stable CLI at release time are proven compatible (current observation: 1.0.13 and 1.0.12);
- 8 of 10 target users complete Task → Review → Verify → Apply without documentation and correctly state remaining blockers within 30 seconds;
- exact public artifact passes checksum, universal-architecture, Developer ID, Hardened Runtime, notarization, stapling, Gatekeeper, install, launch, and real-runtime smoke.

## Assumptions and decisions still required

- Product owner decision before public launch: whether the next product is open source, source available, or distributed under another model. Until decided, no license or public-source promise is made.
- Product owner decision before public launch: final brand and repository slug.
- Product owner action before live-runtime validation: complete official Grok login or provide an approved test account/API-key path. Passwords, CAPTCHA, device confirmation, and security checks remain user-controlled.
- Product owner action before a new release: approve handling of the currently public v1.1.1 artifact and authorize any GitHub Release changes.
- Apple/GitHub credentials and public release remain separate authorization checkpoints.

The naming, trademark, licensing, and distribution statements in this charter are product policy recommendations, not legal advice.
