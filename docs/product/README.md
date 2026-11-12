# Grok code desktop product program

Status date: 2026-09-03
Program status: **GO for a focused product program; NO-GO for the current source or public artifact as a new release candidate.**

This directory is the decision and evidence home for the next version of the product. It turns the broad goal — a Grok-specific desktop product for serious coding work — into bounded scope, a prioritized engineering program, and release gates that cannot be satisfied by mock evidence alone.

## Read in this order

1. [Product charter](2026-09-03-grok-code-product-charter.md) — target user, promise, ownership boundary, scope, non-goals, and success measures.
2. [Upstream and market baseline](2026-09-03-upstream-and-market-baseline.md) — current official Grok capabilities, direct desktop competitors, and the defendable market gap.
3. [Current-state audit](2026-09-03-current-state-audit.md) — verified assets, P0/P1 findings, local quality evidence, and public release evidence.
4. [Delivery and validation plan](2026-09-03-delivery-and-validation-plan.md) — ordered phases, exit gates, quantitative acceptance, authority checkpoints, and first backlog.

## Decisions made

| ID | Decision | Status |
| --- | --- | --- |
| D-001 | Build for Grok Build, not a general multi-provider agent. | Accepted by product owner |
| D-002 | Keep the official Grok Build CLI as the intelligence, authentication, tools, extensions, and model owner; integrate over ACP. | Recommended / plan baseline |
| D-003 | Compete on safe code delivery, independent review/verification, recovery, and evidence — not on generic chat, media, or another feature-list wrapper. | Recommended / plan baseline |
| D-004 | macOS is the first supported product; retain universal Apple Silicon + Intel intent until evidence says otherwise. | Recommended / existing scope |
| D-005 | Do not use `Grok Build Desktop` as the final public brand. It is a working repository/product label only until naming and trademark review. | Open owner decision before next release |
| D-006 | Existing `generic-acp` and mixed-provider work is outside the Grok-focused first release. Preserve history until a migration/removal plan is approved; do not expand it. | Recommended / pending implementation |

## Evidence vocabulary

- **Implemented**: source exists in the current checkout.
- **Locally verified**: a named command or local interaction passed in this checkout.
- **Live Grok verified**: an authenticated official Grok stable runtime completed the named path.
- **Installed-app verified**: the packaged application completed the path on a supported Mac.
- **Release verified**: the exact downloadable artifact is bound to a clean commit and passes checksum, architecture, signature, notarization, Gatekeeper, install, launch, and smoke checks.
- **Blocked**: an explicit dependency or user-controlled action prevents the check.
- **Not run**: no result is claimed.

No lower evidence level may be presented as a higher one.

## Current top blockers

1. The exact public v1.1.1 DMG downloaded from GitHub has an invalid code signature even though it is universal and carries Developer ID/notarization metadata. Handling the existing public asset is a parallel owner-authorized incident lane; it does not block local source stabilization.
2. The product tracks local Grok 1.0.5 while official stable is 1.0.13; 1.0.6 removed a subagent field still used by the bundled harness.
3. Default worktrees live inside the source repository and can make the main checkout dirty, which then blocks the product's own Apply preflight; the dirty-copy path can also lose user state.
4. Repository-writable `.grok/profile.md` content is injected into a trusted prompt partition.
5. Completion evidence is not bound strongly enough to the execution root, HEAD, diff, and exact run; manual UI evidence can be recorded as passed without an independently verified artifact.
6. One task's fallback/reload path can stop the globally active runtime connection belonging to another task.
7. UTF-8 content can hit byte-boundary truncation panics in Host/audit/diff paths, and the CLI installer executes a downloaded script after only a size check.
8. Current `main` is 24 commits beyond the v1.1.1 tag while still identifying itself as 1.1.1; source, version, tag, and artifact are not one-to-one.
9. Current source fails Rust formatting and strict Clippy gates; parity remains provisional and existing “E2E” does not exercise the installed Tauri app with real Grok.

These are release blockers, not reasons to abandon the product. The delivery plan closes them before feature expansion.
