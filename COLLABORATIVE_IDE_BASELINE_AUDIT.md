# Collaborative IDE Baseline Audit

**Task:** B0.1 — inventory existing functionality  
**Date:** 2026-08-11  
**Status:** done; product features remain unverified until the B0.2 fixture
environment is available.

## Orca integration correction — 2026-08-12

The stable fixture created after this audit proved contracts and isolated UI
states, but it did not make those controls available in the authenticated
workspace. Orca is the mandatory product shell: every user-visible capability
must be integrated into Orca's native panels, dialogs, editor, Explorer,
worktree cards, terminal, or status bar and verified at
`/workspaces/<workspaceId>` on the validated preview. Fixture-only evidence is
supporting test evidence and cannot establish product completion.

## Evidence collected

- Focused implementation tests passed: `22` tests in `6` files.

  ```text
  pnpm --dir apps/web exec vitest run \
    lib/access.test.ts lib/agent-coordination.test.ts lib/oauth.test.ts \
    lib/workspace-state.test.ts lib/credentials.test.ts lib/agent-branch.test.ts
  ```

- Computer Use opened the existing production workspace URL in Google Chrome.
  The visible result was **“Could not open the workspace — The workspace
  project could not be opened.”** Screenshot captured at
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%205.56.48%20AM.jpeg`.

The screenshot is environment-local evidence and may be ephemeral. It is not
committed to the repository.

## Capability assessment

| Backlog area                 | Status  | Existing evidence                                                                                                                             | What is still required                                                                                                                               |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — access and invites      | Partial | Role-to-capability mapping in `apps/web/lib/access.ts`; invite and membership API routes exist.                                               | Two-identity UI coverage for create, accept, revoke, expiry, and live role changes.                                                                  |
| F2 — editor and presence     | Partial | Workspace collaboration API/server exists; Yjs state journal is tested in `apps/web/lib/workspace-state.test.ts`.                             | Live two-user editor, presence/cursor, reconnect, and external-change conflict evidence.                                                             |
| F3 — shared sessions         | Partial | Agent turns, stream, and interrupt API routes exist; durable agent events are encoded in workspace state.                                     | Visible shared queue/transcript, co-steering attribution, refresh recovery, and UI verification.                                                     |
| F4 — parallel agents         | Partial | Agent worktrees and path-claim matching exist (`apps/web/lib/agent-coordination.test.ts`).                                                    | Reconcile the current documented two-agent limit with the three-agent goal; verify server enforcement, workboard, claims, and fourth-slot rejection. |
| F5 — review/integration      | Partial | Branch, discard, review, and GitHub publication code/routes exist.                                                                            | Review-ready checkpoint, stale-review handling, integration, discard, audit, and visual verification.                                                |
| F6/F7 — provider connections | Partial | Encrypted credential handling and OpenAI/Codex/Claude OAuth routes exist; OAuth PKCE behavior is unit tested in `apps/web/lib/oauth.test.ts`. | Provider UI, revocation-before-turn behavior, provider-neutral events, and verified provider-specific OAuth integration.                             |
| F8 — recovery/timeline       | Partial | Runtime resume, lifecycle, hibernation, audit, and observability modules/tests exist.                                                         | User-visible timeline, event replay, filtering/jump behavior, and recovery flow.                                                                     |
| F9 — terminal collaboration  | Partial | Authenticated terminal server and terminal capability mapping exist.                                                                          | Read-only following, exclusive input holder/handoff, attribution, and two-user UI test.                                                              |
| F10 — guardrails/operations  | Partial | Rate-limit, usage, lifecycle, audit, and observability modules exist.                                                                         | Owner-visible limits, health/recovery cards, workspace freeze, and UI evidence.                                                                      |

## Baseline blocker

The current production workspace fails to open. It would be misleading to mark
any browser-based collaboration feature complete without a stable fixture
workspace and two test identities.

## Next task

**B0.2 — create a stable local verification entry point and documented fixture
identities/data.**

Its first step is diagnosis, not a broad rewrite: identify why the production
workspace cannot open, then establish the smallest local or preview fixture
that permits the required Computer Use flows without real credentials.
