# Superset multi-agent integration handoff

**Status:** Implementation plan, revised 2026-10-02. No new integration phase is verified by this document.
**Branch:** `codex/superset-agent-isolation`; merge `670f3053b5` includes `origin/main` at `31ec6e66ff`.

## Goal and product boundary

Run Superset-managed CLI agents inside one Gen 2 Firecracker guest, with multiple independent agents visible in one CoDev workspace. Give independent writers separate Git worktrees. Reuse Superset's worktree, terminal, agent launch, binding, subagent, and recovery mechanics where they fit; retire duplicate guest mechanics as each capability becomes proven.

CoDev remains authoritative for membership and role policy, member credential selection and encryption, billing and credential seats, durable chats and run records, and the decision to recover or resume. Superset owns guest-local worktrees, PTYs, agent processes, lifecycle observations, and local session state. The browser calls CoDev endpoints and never receives a host bridge secret or credential profile.

**Recommended rollout change:** Do not make a persistent terminal agent masquerade as a fresh `codex exec --json` or Claude stream-json turn. Keep the existing Gen 2 chat route working while an internal Superset agent-session capability is proven. Adapt the chat experience to persistent sessions only after its output, cancellation, and history contract is deliberately designed and verified. The existing `CODEV_GEN2_SUPERSET_AGENT_SESSIONS` switch must remain off for general traffic until that decision is implemented.

The first milestone is two independent agents in two worktrees. A CLI agent's own spawned subagents are a later display and attribution milestone; they are not separate CoDev billable launches by default.

## Current implementation and gap

- `apps/web/lib/gen2/superset-agent-runtime.ts` has CoDev run records, credential resolution, seats, and an orchestrator adapter. Its flag-gated turn path currently replaces the existing chat turn contract.
- `vendor/superset/packages/host-service/src/codev/agents.ts` starts a CLI inside Superset terminal primitives with an isolated launch profile and command gate. Its agent identity and idempotency maps are process memory, and its `/recovery` path is conservative after a host restart.
- `vendor/superset/packages/host-service/src/trpc/router/agents/agents.ts` contains Superset's native launch and continuation behavior. It also reads host-default account configuration, which is inappropriate for CoDev's member-specific launches.
- `vendor/superset/packages/host-service/src/terminal-agents/` contains the binding store, SQLite persistence, subagent roster and transcript harnesses, and resume-candidate logic. The CoDev bridge currently bypasses this path because it has no real hook events for its launched processes.
- `vendor/superset/packages/host-service/src/trpc/router/notifications/notifications.ts` accepts public lifecycle hooks. Its attribution token protects account capture, not every binding-changing event. A CoDev multi-member host needs a per-launch trust boundary before relying on hooks for status or recovery.
- Current `main` has a browser-to-CoDev terminal WebSocket with HTTP polling fallback; the upstream guest/Superset side still polls snapshots. Keep that current transport and do not revive the branch's older raw-stream host path. Agent progress needs its own safe projection; terminal transport is not an authorization or redaction boundary.

## Where to work and what to build first

Work in the existing `codex/superset-agent-isolation` worktree, not a new branch from `main`. It contains credential profile delivery, private agent UIDs, cleanup, command gates, and CoDev run records, and now includes current `origin/main`. The primary checkout is on another branch with unrelated files. Do not copy its working tree into this branch. Before each implementation slice, fetch `origin/main`, compare it with this branch, and merge relevant updates here; preserve CoDev's current behavior if paths conflict.

**The first build target is one secure, observable persistent agent.** Its CoDev run ID must resolve to exactly one Superset worktree, terminal, provider, and member connection. A real hook must create a Superset binding; terminal exit must clean the private profile and release the CoDev seat. Build the second concurrent agent only after that path is proven. Do not build the agent roster or swap the existing chat turn route first.

The existing `agentWorktreeIdForChat` in `apps/web/lib/gen2/superset-agent-runtime.ts` deliberately reuses one worktree per chat. That is safe for sequential turns but does not isolate two independent agents in the same chat. For this feature, assign a worktree per independent agent session/task. Continuing that agent retains its worktree; a second independent writer gets a different one. A chat may reference multiple agent sessions.

## Proposed permission contract for persistent agents

Apply this to the new persistent-agent capability first; audit the existing fresh-turn chat policy separately so the rollout does not silently change current behavior.

- All current workspace members may list agent metadata and read a filtered progress view. Raw PTY output and private profiles are never a general member API.
- Owners and editors may launch, subject to the requesting member's credential eligibility, workspace billing gate, and concurrency policy. Viewers cannot launch.
- The creator may send input and cancel. A workspace owner may cancel any run for safety. Other editors and viewers cannot send input or cancel someone else's run.
- Only the creator may resume a provider session, using a freshly resolved credential. An owner may stop or mark a run for recovery, but cannot inherit another member's provider connection.
- A removed member loses access immediately. The run is reconciled according to policy; removal never transfers credential ownership to another member.

Enforce this policy in `apps/web/lib/gen2/`, not only in UI controls or thin API routes. Return a non-disclosing error for a foreign run ID. The host independently verifies its persisted run-to-terminal-to-worktree mapping on every operation, because possession of the private bridge secret alone must not turn an arbitrary terminal ID into an agent session.

## Reviewable implementation slices

Each slice below should be a separate reviewable change. Do not start the next slice merely because the code compiles; use its pass condition. The phase descriptions below explain the full lifecycle; these slices are the build order.

### Slice A — baseline and policy tests

**Touch:** `apps/web/lib/gen2/agent.ts`, `superset-agent-runtime.ts`, `superset-runs.ts`, their tests, and shared request/response schemas in `packages/contracts/src/gen2.ts` only if a shape changes. Keep API route handlers thin.

**Do:** Record Linux baseline results for CoDev, Rust guest, and Superset host. Add a single policy function used by list/start/input/poll/cancel/recover. Test the proposed role and run-owner matrix, current-membership recheck, credential selection, billing gate, and idempotent denial before any orchestrator call. Preserve the fresh-turn route's existing behavior while the new capability is gated.

**Pass:** A viewer cannot launch; another editor cannot input or cancel the creator's run; the owner can stop it; a former member cannot observe or control it; foreign run IDs disclose no output. Denials never wake the guest or claim a credential seat.

**Slice A checkpoint (2026-10-02):** The Gen 2 library now rechecks membership and role for persistent run actions before credential selection or host access. Raw session polling remains creator-only; the shared list returns metadata without connection IDs, host IDs, or errors. A reused idempotency key must match its original creator, chat, worktree, provider, and connection. The existing fresh-turn delegate retains its prior policy. Its authorization needs a separate audit before the persistent capability is exposed in the UI.

Validation on this Windows host: repository typecheck passed; lint passed with existing warnings; the full web suite passed (838/838) with four workers; Superset's host command/profile checks passed (3 passed, one Linux-only UID test skipped). The root `pnpm test` stops at the infrastructure shell suite (9 passed, 3 Windows path/shell failures). Rust `cargo` is unavailable and WSL access is denied here. Run the CoDev infrastructure suite, Rust guest suite, and Superset host PTY/UID suite on Linux before treating this checkpoint as a complete baseline or starting VM acceptance.

### Slice B — durable identity and one worktree per independent agent

**Touch:** `apps/web/lib/gen2/superset-runs.ts`, `superset-agent-runtime.ts`, existing `packages/db/src/schema.ts` only if the current run row lacks required identity, `vendor/superset/packages/host-service/src/codev/agents.ts`, and the host's existing SQLite schema/migrations. Follow forward-only migration rules.

**Do:** Replace per-chat worktree assignment for persistent agents with a per-session/task assignment. Persist immutable CoDev run, member, provider, connection, worktree, and host terminal linkage without secrets. Persist a minimal host-side CoDev agent registration so operations remain scoped after a host restart. Validate idempotency keys against that complete identity; never relaunch a second PTY on retry. Use Superset's registered Git worktree lookup, including direct children of `/workspace`.

**Pass:** Two independent starts in one chat choose different worktrees; retrying either start returns the same run and terminal; forged or mismatched worktree/terminal IDs fail before input, poll, stop, or recovery. Both worktrees survive guest restart.

**Slice B checkpoint (2026-10-02):** A chat-delegated start without an explicit worktree now derives a stable worktree ID from its idempotency key. Retries reuse it; independent starts in one chat receive different worktrees. The CoDev run ID and workspace ID now travel with the launch request. Superset persists a private, secret-free `codev_agent_runs` registration that binds the CoDev run, provider, idempotency key, worktree, host workspace, and terminal. Every bridge operation reloads that registration and verifies its terminal-to-worktree mapping before touching the terminal. A retry after host restart reattaches to the persisted terminal; it never launches another PTY.

Validation on this Windows host: focused CoDev tests passed (41/41); focused Superset registration, migration, command-policy, and profile-isolation checks passed (10 passed, 1 Linux-only UID test skipped). Superset-wide typecheck remains blocked by pre-existing vendored auth and generated-locale type errors; it contains no remaining Slice B diagnostics. Rust checks remain unavailable because `cargo` is not installed. Linux host/guest and VM acceptance remain required before the next acceptance gate.

### Slice C — shared Superset launch path and private profile

**Touch:** `vendor/superset/packages/host-service/src/trpc/router/agents/agents.ts`, `src/codev/agents.ts`, `src/codev/agent-isolation.ts`, and their existing tests. Add a shared helper only for operations used by both the native and CoDev launchers.

**Do:** Reuse native Superset command construction, terminal creation, safe prompt framing, and continuation checks where they fit. Keep CoDev's exact provider command policy and private UID/profile. The CoDev adapter provides a per-launch profile and must bypass native host-default account selection; it must not install member credentials into a global agent configuration. Leave `codev-guestd` as a validating private proxy.

**Pass:** One CoDev agent launches through the shared path in the intended worktree; native launcher tests still pass; ordinary shells and a second agent cannot read its profile; arbitrary command, environment, path, and provider substitutions fail.

**Slice C checkpoint (2026-10-02):** Native Superset and CoDev agent launches now share terminal launch-option construction. Native launches retain their existing command builder, prompt framing, continuation checks, and default-account behavior. CoDev deliberately supplies only its prepared profile: the common path disables the host default account, sets the private home, and starts the terminal under that profile's distinct UID. The CoDev launch script remains the safe argv-framing boundary, while its exact provider command gate and the guest proxy's profile validation remain in force. Native command construction and continuation binding cannot be shared with CoDev yet because the former reads a host-wide account and the latter relies on hook-created bindings; Slice D supplies those trusted bindings.

Validation on this Windows host: the shared launch-option test, CoDev registration/migration/policy/profile tests, and all compatible native agent tests passed (71 passed; one Linux-only UID test skipped). One native fork-preflight fixture is Windows-path-incompatible, so that test must be rerun on Linux with the host suite. Repository typecheck passed; lint passed with existing warnings. Superset's formatter check still reports pre-existing formatting/import issues in large touched upstream files; the newly added helper and test conform to its formatter.

### Slice D — genuine headless hooks and Superset bindings

**Touch:** Superset's guest/host startup integration, `terminal-agents/`, `trpc/router/notifications/notifications.ts`, and the CoDev bridge. Use the existing hook harnesses for Codex and Claude.

**Do:** Provision hook scripts and per-launch CLI hook configuration on a systemd-started guest. Give each launch an unguessable local attribution token and bind lifecycle and child-agent hook events to the registered terminal before changing `TerminalAgentStore`. The public desktop notification path must not be accepted as proof of a CoDev member or run. Track PTY liveness separately; missing hooks mean `unknown`, not `idle` or `completed`. Do not invent synthetic lifecycle events.

**Pass:** A real Claude launch, then a real Codex launch, creates the expected persisted binding and status transitions in a headless VM. Forged, replayed, and cross-terminal events cannot alter another run. Child subagents attach to the correct parent without gaining separate credential access.

**Slice D implementation checkpoint (2026-10-02):** Each new CoDev launch now receives a random token that is stored only as a SHA-256 hash with its durable host registration. Its private provider profile supplies the existing Superset Codex or Claude hook configuration and passes that token through the existing hook payload. Codex launches explicitly enable trusted execution of this host-created private hook configuration, and the exact command gate requires that flag. The public notification endpoint looks up the CoDev registration before mutating `TerminalAgentStore`; missing, forged, replayed, and cross-terminal tokens are ignored. The profile config also gives Claude its private `CLAUDE_CONFIG_DIR`. PTY exit continues to determine terminal liveness separately, while absent hooks create no synthetic agent lifecycle.

Validation on this Windows host: focused host bridge/profile/migration/lifecycle tests passed (18 passed, one Linux-only UID test skipped) and the focused Gen 2 command test passed (17/17). Repository typecheck passed; lint completed with pre-existing warnings. Host-service typecheck has no Slice D diagnostics, but remains blocked by pre-existing vendored auth and generated-locale errors. The real headless Claude/Codex VM test, Linux PTY/UID suite, and child-subagent acceptance remain required for Slice D's pass condition.

### Slice E — lifecycle, credential refresh, and safe recovery

**Touch:** `src/codev/agents.ts`, profile cleanup, `apps/web/lib/gen2/superset-agent-runtime.ts`, `superset-runs.ts`, and the existing credential write-back path. Do not change `resolveCredential` or the provider registry.

**Do:** Record real exit outcomes; preserve `unknown` when an exit code is unavailable. Capture refreshed provider state into only the creator's encrypted connection before deleting the profile. Clean on natural exit, cancel, failed start, daemon loss, and restart. Heartbeat the credential seat from verified running agent work, not browser polling. Reconcile CoDev and host records after restart; ambiguous identity becomes `recovery_required`. Resume only through an explicit creator action and a fresh profile.

**Pass:** Fault-injection tests around each state transition produce exactly one durable outcome, no duplicate process, no leaked profile, and no held seat. A host restart cannot convert an unknown exit into success or silently relaunch with stale credentials.

**Slice E implementation checkpoint (2026-10-03):** The host persists each private profile directory so an ended terminal can capture the refreshed Codex cache and remove the profile after a host restart. Refresh data stays on the private bridge and is written only to the run creator's matching encrypted connection; it is removed before any CoDev response reaches a browser. Terminal exit without a code is recorded as `exit_unknown`, and terminal outcomes transition once. Empty browser polls no longer heartbeat a credential seat; changed terminal output and verified recovery do. An unconfirmed cancellation becomes `recovery_required` rather than `finished`.

Validation on this Windows host: focused web lifecycle, run-state, and bridge-client tests passed (44 tests); host bridge and migration tests passed (7 tests); web typecheck passed. Host-service typecheck remains blocked by pre-existing vendored auth and generated-locale diagnostics, and Rust validation remains unavailable because `cargo` is not installed. Linux fault-injection and VM acceptance remain required for the Slice E pass condition.

### Slice F — CoDev facade and safe output

**Touch:** `apps/web/lib/gen2/superset-agent-runtime.ts`, the existing orchestrator client, matching Gen 2 API routes, `packages/contracts/src/gen2.ts`, and output tests. Use current main's terminal transport where appropriate; do not copy its raw terminal payload into an agent progress API.

**Do:** Expose list/start/input/poll/cancel/recovery through CoDev authorization. Define bounded snapshot cursors and persist a filtered run transcript. Treat PTY text, sourced script paths, and provider output as untrusted and potentially secret-bearing. Keep any raw terminal view more restricted than the shared progress view. Ensure file and Git changes from each agent appear in that worktree's existing panels.

**Pass:** Two members can observe two simultaneous runs and their branch changes without reading profiles or host secrets. Refresh and reconnect do not duplicate output or lose a final status. Existing chat, terminal, file, Git, and sharing tests still pass.

### Slice G — agent roster and controlled rollout

**Touch:** `apps/web/components/gen2/` and the existing workspace shell. Follow `docs/design/superset-workspace-ui.md`, `docs/design/workspace-controls.md`, shadcn/ui, and `WorkspaceButton` conventions.

**Do:** Show parent agents, owner, provider, branch/worktree, trustworthy status, filtered output, and permitted controls. Show child subagents only after Slice D. Keep the existing chat turn UI and its fresh-turn route. Exercise the full Linux host suite and Gen 2 VM acceptance matrix below before enabling the capability outside an internal workspace.

**Pass:** A member can run and inspect two independent agents from one workspace page; role-specific controls match server policy; changing branches shows the correct files and diffs; disabling the flag leaves current Gen 2 behavior intact.

## Verification and rollout gates

1. **Focused code tests:** CoDev role and run policies, seat lifecycle, idempotency, output redaction, host command and profile validation, registered worktree resolution, binding hooks, and recovery transitions.
2. **Linux host suite:** PTY start/input/snapshot/exit, `tsx`-dependent tests with the loader configured, process and daemon loss, profile permissions, two isolated UIDs, and hook attribution.
3. **Gen 2 VM acceptance:** Codex and Claude; two agents in separate worktrees; viewer and cross-member denial; revoked connection; natural exit, cancellation, host restart, guest restart, hibernation/restoration; correct billing attribution and seat release.
4. **Release gate:** Resolve or explicitly baseline repository typecheck/lint/test failures. Enable the new capability only for an internal workspace, observe metadata-only starts, exits, recovery, profile cleanup, and seat durations, then widen the flag. Keep the current chat path as rollback until parity is proven.

## Handoff notes

- The integration branch is checked out at `C:\Users\qais4\.codex\worktrees\superset-agent-isolation\CoDev`; the primary checkout is on another branch with unrelated untracked files. Use the integration worktree explicitly.
- The merge commit and Slices A and B are pushed. The worktree has an untracked `apps/mobile/` directory; preserve it until its owner is known.
- Read `docs/README.md`, `docs/SUPERSET_AGENT_SESSION_PLAN.md`, `docs/SUPERSET_WORKSPACE_OWNERSHIP.md`, and the applicable `lib/` README before editing. The earlier session plan describes the existing flag-gated chat replacement; this handoff changes the rollout order, not CoDev's credential foundation.
- Do not run the web app before `pnpm db:check`. Use Node 24+ and `pnpm`. The full host PTY and Rust suites need Linux; no Gen 2 VM acceptance run has been completed for this integration.
