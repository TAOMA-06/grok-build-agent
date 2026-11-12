# Delivery and validation plan

Plan date: 2026-09-03
Planning assumption: one primary implementation lane plus an independent review/quality lane. Estimates are ranges, not promises.

## Program outcome

Deliver a distinctly branded, Grok-specific macOS coding workbench whose core value is safe, observable, independently verified code delivery.

The program is not complete when the UI looks finished or unit tests are green. Completion requires a clean, frozen release commit and exact downloadable artifact evidence.

## Phase map

| Phase | Outcome | Estimate | Exit decision |
| --- | --- | --- | --- |
| R0 — Charter and evidence baseline | Product scope, market gap, architecture audit, quality truth, prioritized gates | Completed by these documents | GO only for stabilization |
| R1 — Containment and safety invariants | Close source-safety P0s and restore source gates in ordered R1a/R1b/R1c slices | 1–2 weeks | G1 Engineering foundation |
| R2 — Current Grok compatibility | Capability-driven latest/previous stable integration (currently 1.0.13/1.0.12), fixtures, hook/MCP/permission handling | 1–2 weeks | G2 Protocol compatibility |
| R3 — Real vertical code-delivery slice | Authenticated Grok task from Plan through Apply and Receipt, plus crash recovery | 1–2 weeks | G3 Live product proof |
| R4 — Differentiated code cockpit | Independent Review/Verify, evidence UX, performance, diagnostics, focused polish | 2–4 weeks | G4 Feature-complete candidate |
| R5 — Independent audit and candidate freeze | Gold set, red team, competitor cross-audit, installed-app QA, clean SHA | 1–2 weeks | G5 Release candidate |
| R6 — Signed release | Rebuild, notarize, re-download, install, smoke, rollback guidance, and optional updater proof | 2–5 days plus external processing | G6 Publish recommendation |

R6 publication is not authorized by this plan. Publishing or altering an existing public Release requires a separate owner confirmation. The existing v1.1.1 incident is a parallel owner-authorized artifact lane and does not block local R1 work.

P0 work has three evidence lanes:

- **Source safety and recoverability:** R1/G1 owns worktree, trust, verification, task lifecycle, idempotency, Unicode, version identity, and quality gates.
- **Runtime compatibility:** R2/G2 owns the release-frozen latest/previous stable matrix and authenticated protocol proof.
- **Published artifact incident:** an independent owner-authorized lane preserves evidence and decides whether to warn, unpublish, replace, or supersede v1.1.1.

## R1 — Containment and safety invariants

### Work

R1a — recoverability and worktree integrity:

1. Move managed worktrees and code-index caches outside user repositories.
2. Make dirty-source policy truthful; preserve a lossless bounded state or refuse unsupported state.
3. Add default-path create → edit → review → Apply coverage.

R1b — trust and verification schema:

4. Move trusted project profiles to product-owned storage; treat repository files as untrusted.
5. Redesign CompletionGate provenance and manual-evidence status.
6. Add a versioned execution-receipt schema and validator, including context digest and truncation provenance.

R1c — task ownership and source gates:

7. Scope stop/reload/recovery to exact task + connection + process identity.
8. Persist stable operation IDs plus canonical request digests for Apply/Commit/PR and other side effects.
9. Fix authentication health, Unicode-safe bounds, and async blocking paths.
10. Remove Grok-first-release production UX/code for `generic-acp`, Secondary ACP, Mixed planning, Planner handoff, and cross-Agent fallback. Retain ACP wire support and test-only mock injection.
11. Hide Host Jobs and remove scheduling/execution claims until an actual due-task scheduler/executor has a separately approved scope.
12. Remove or quarantine the 40 tracked duplicate ` 2` paths after exact-content review.
13. Establish one authoritative product version, embed source SHA, enforce tag/version equality, and refuse a previously published version for different source.
14. Fix Rust formatting and strict Clippy errors.
15. Replace the parity smoke's synthetic pass behavior with `not_run` unless recorded evidence exists.
16. Change in-app CLI installation to a verified official artifact/script contract when one exists; otherwise use a manual handoff or explicit risk confirmation.

### Exit gate G1

- Frontend check, Rust fmt, strict Clippy, Rust tests, release safety, and diff check all pass.
- Default worktree create → edit → review → Apply passes in a disposable Git repo without changing source-checkout status before Apply.
- Trusted prompt partition contains no repository-writable content.
- CompletionGate rejects stale, cross-root, cross-diff, manual-as-automated, failed, skipped, and not-run evidence.
- Two simultaneous task fixtures prove stopping/reloading one does not interrupt the other.
- A disconnect/retry fixture proves each side effect occurs at most once; the same operation key with a different request digest is rejected.
- Chinese, emoji, and combining-character fixtures crossing every production text limit do not panic or split code points.
- A deliberately blocking CLI management command does not block another task's cancel, permission response, or Host health request.
- Duplicate-path cleanup is reviewed and its effect on imports/tests is green.
- Production UI and runtime launch contain no selectable non-Grok executable path; mocks remain test-only.
- Host Jobs no longer imply scheduling/execution that has not been implemented.
- Product version, source SHA, tag, and artifact version are one-to-one.
- A non-empty auth file is reported only as “credentials present, unverified”; expired, truncated, and corrupt credential fixtures never produce Ready.

## R2 — Current Grok compatibility

### Work

1. Obtain isolated binaries for the latest official stable and immediately previous stable without replacing the user's global CLI; current observed targets are 1.0.13 and 1.0.12. Verify official source, digest/signature, and version; if historical binaries are not verifiably available, record an external blocker.
2. Capture redacted fixtures for initialize, auth methods, session new/load/list/close, modes/config options, model/effort, permission choices, tool updates, plan approval, subagents, workflows/background tasks, Hook asks/defer/context, MCP elicitation, cancel, prompt completion, and resume.
3. Replace hard-coded new-install model/effort values with live ACP capabilities.
4. Version or remove `capability_mode` harness behavior for 1.0.6+.
5. Normalize logical `x.ai/*` and wire `_x.ai/*` names in one place.
6. Gate attachments, session operations, rewind/restore, and private extensions from live capability/probe receipts.
7. Keep Desktop-owned worktree/session/task state distinct from official CLI-owned state.
8. Add an upstream watcher that opens a local compatibility report; it must not auto-enable or auto-publish support.

### Exit gate G2

- Latest stable and previous stable pass the recorded no-inference protocol suite.
- Critical lifecycle `initialize → authenticate → session/new/load → prompt → permission → cancel → config → resume/close` passes on both with an approved test credential.
- Calls to undeclared private methods: 0.
- Unknown stable/future versions block new Runtime write tasks, session restore/resume, undeclared private methods, and automated external side effects. Existing local changes remain reviewable, exportable, checkpointable, and eligible for an explicit local Apply decision so user work is never trapped.
- UI never offers an image, mode, effort, model, or session action absent from the active capability receipt.
- macOS filesystem isolation and network-isolation truth are displayed separately.

## R3 — Real vertical code-delivery slice

Use a disposable, versioned fixture repository and an approved Grok account. Do not use the product repository or mutate personal projects for acceptance.

### Required journey

1. Add fixture project.
2. Create external managed worktree from a clean base.
3. Enter Host-enforced Plan; attempt known edit/shell/subagent bypasses and prove zero source writes.
4. Approve plan explicitly.
5. Let Grok implement a bounded change.
6. Record all permissions, tool calls, terminal activity, changed files, failures, model, effort, and runtime receipt.
7. Freeze diff; run an independent reviewer.
8. Run declared tests/build/lint through Host-owned verification.
9. Crash/kill renderer, Host, and Grok at selected points; reconcile according to the exact delivery state without duplicate prompt or side effect.
10. Preview Apply, create checkpoint, re-run preflight, Apply, verify destination, and export a receipt that passes the versioned receipt-schema validator.

### Comparison protocol and exit gate G3

- Freeze official stable version, model, reasoning effort, repository/task snapshots, tool/permission policy, timeout, and scoring rubric.
- Run each of the ten paired tasks three times per surface in randomized order.
- Two reviewers who did not implement the change score anonymized results against the same binary rubric; disagreements are resolved and recorded before aggregate scoring.

- Ten real tasks exercise the full journey; Desktop succeeds on at least 27/30 runs.
- False Verified/Ready states: 0.
- Unapproved protected/out-of-scope writes: 0.
- Duplicate prompts or Git side effects: 0.
- Cross-worktree writes: 0.
- Every task produces a receipt that passes schema, provenance, redaction, preview, and secret-scan checks.
- Desktop records no more than three additional failed runs versus the official TUI across the 30 paired runs. Report task-level results and a bootstrap confidence interval as descriptive evidence; do not claim percentage-point non-inferiority from this pilot.
- Crash expectations are state-specific: pre-ACP intent may resume; acknowledged results restore; `sending` with unknown outcome becomes `delivery_unknown` and is never replayed automatically; local modifications retain review/export/checkpoint access.

## R4 — Differentiated code cockpit

### Product work

- One task state machine: Draft → Planning → Awaiting approval → Implementing → Reviewing → Verifying → Ready/Blocked → Applied/Rejected.
- Review/Verify panel driven by frozen evidence, not transcript inference.
- Finding disposition, command logs, artifact preview, diff hash, and remaining-risk summary.
- Multi-project Mission Control focused on action needed and delivery state, not duplicating the official Dashboard feature list.
- Compatibility/health receipt visible from every task.
- Exportable Markdown/JSON execution receipt.
- Open-in-editor actions rather than IDE emulation.
- Focused macOS interaction, accessibility, keyboard navigation, light/dark/system appearance, and large-event performance.

### Measurement protocol and exit gate G4

- Before measuring, freeze the product SHA, Grok version, model, macOS version, reference Mac hardware, fixture hashes, event generator seed, sampling tool, and whether UI, Host, Grok, MCP, and child processes are included.
- A fixed 10,000-event dataset renders with frame-time p95 ≤18.2 ms after warm-up on the reference Mac.
- After a 30-minute steady-state window, total resident memory for declared included processes is ≤750 MB for one session and ≤1.5 GB for four sessions.
- Across at least 50 cancel trials, request-to-owned-process-exit p95 is ≤2 seconds.
- Four parallel worktrees × 20 rounds show zero cross-write, orphan process, duplicate submission, or lost accepted message.
- Fifty seeded crash points use a written definition of `acknowledged`; they recover every acknowledged intent and never replay uncertain intent automatically.
- Ten target users: at least eight finish Task → Review → Verify → Apply without instructions and correctly identify blockers within 30 seconds.

## R5 — Independent audit and candidate freeze

### Evaluation suites

- Replace/expand the current 28-task parity set with recorded evidence for every task.
- 20 Plan bypass cases: shell redirection, scripts, child agents, symlinks, alternate tools, and path aliases.
- 30 protected-path/destructive Git/delete/network/publish cases.
- 25 planted P0/P1 defects for a blinded, read-only reviewer independent from the implementing run: target recall ≥80%; false-discovery rate ≤15% of all findings reported as defects.
- Release-frozen latest/previous stable compatibility fixtures.
- Real installed-app journeys on Apple Silicon and Intel.
- Cold/warm start, long run, high event volume, sleep/wake, offline/reauth, CLI crash, Host crash, renderer crash, and update rollback.

### Exit gate G5

- Clean candidate SHA with no unexplained files and all version sources aligned.
- All declared local CI gates pass from a fresh dependency install.
- Full gold set scored; skipped/not-run cannot satisfy the gate.
- P0 findings: 0 open.
- P1 findings: 0 open unless individually accepted by the owner with visible release-note impact.
- Competitor cross-audit repeated after feature completion.
- No credential, personal path, session content, or unsafe diagnostic artifact in tracked source/release assets.

## R6 — Signed release

### Exact artifact gate G6

- Apple Silicon and Intel slices present in both main and Host.
- Developer ID Application identity, Hardened Runtime, timestamp, designated requirements, and no `get-task-allow` verified.
- Notarization accepted and stapled; Gatekeeper accepts the exact app after internet-style download/quarantine.
- DMG integrity passes; app is copied to a clean `/Applications` test destination and cold-launched.
- Exact artifact SHA, SBOM, license report, provenance, and source SHA are published together.
- Re-downloaded public assets match recorded hashes and repeat all applicable checks.
- For the first corrected release, a truthful manual-DMG update path is acceptable if UI copy, download, install, and rollback guidance pass. Automatic update may be added only in an explicitly scheduled R4/R5 work item and then must prove download, signature validation, replacement, relaunch, and failure rollback.
- One real Grok login/ACP code task passes from the installed build.

## Immediate ordered backlog

No item below authorizes implementation outside the repository or public release changes.

1. For each source P0, first create the evidence type that proves the current failure: a regression test, disposable-repository reproduction, protocol fixture, or exact-artifact check.
2. Repair worktree location, dirty-state handling, and the Apply full journey.
3. Repair the trusted/untrusted project profile boundary.
4. Bind verification/manual evidence and add the receipt schema validator.
5. Make runtime lifecycle task-scoped and side effects idempotent by key plus request digest.
6. Restore fmt/Clippy/CI; remove synthetic parity passes, reviewed duplicates, fake generic runtime scope, and unimplemented Host Jobs claims.
7. Establish latest/previous stable compatibility fixtures and migrate the harness away from removed `capability_mode`.
8. Run one authenticated gated task, then expand to the paired ten-task vertical slice.
9. Only after G3, proceed to focused Review/Verify/Receipt UI work.

Parallel incident lane, only after owner authorization: decide whether to unpublish, replace, or prominently warn on public v1.1.1, preserve the evidence, and rebuild through the protected artifact gate.

## Authority checkpoints

The following require explicit owner action or authorization:

- changing, replacing, unpublishing, or deleting the existing GitHub Release;
- updating the user's globally installed Grok CLI;
- entering passwords, completing OAuth/device confirmation, CAPTCHA, or security checks;
- using a paid API key or consuming meaningful model usage for the live matrix;
- Apple Developer/App Store Connect credential configuration;
- committing, pushing, tagging, publishing, or announcing a release.

Local source edits and isolated fixtures may proceed after the product owner accepts this plan.

## Decision requested from the product owner

Approve or revise this program before R1 implementation. The most consequential decisions are:

1. Accept the evidence-first professional developer positioning.
2. Accept removal/deprecation of general multi-runtime scope from the first release.
3. Accept a new primary brand before the next public release.
4. Choose how urgently to handle the invalidly signed public v1.1.1 artifact.
