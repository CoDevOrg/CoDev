# Superset multi-agent integration handoff

**Status:** Implementation plan, 2026-10-02. No new integration phase is verified by this document.
**Branch:** `codex/superset-agent-isolation`; merge `7ae9d39e15` includes `origin/main` at `0a2c880d50`.

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
- Current `main` uses terminal snapshot polling. Keep that transport; do not restore the removed raw-stream or WebSocket terminal path.

## Build sequence

### 0. Establish a reproducible baseline

Record the exact local branch, `origin/main` SHA, tool versions, and a focused test manifest. Separate Windows-only test limitations and unrelated baseline failures from changes introduced by this work. The 2026-10-02 merge passed 22 focused CoDev tests and 3 host policy/isolation tests; one host isolation case skipped on Windows. Repository-wide typecheck, lint, and test are not green on this checkout (missing CLI file, web lint errors, and Windows shell-path failures), and the vendored host typecheck reports dependency errors. Do not treat those failures as integration regressions without reproducing them on `origin/main` or Linux.

**Exit:** A Linux test environment can run the focused host PTY suite with the required `tsx` loader; baseline failures are recorded with owners before code changes.

### 1. Freeze the CoDev authorization and run contract

Define separate permissions for viewing agent metadata and output, launching, sending input, cancelling, and resuming. Decide explicitly whether an editor may control another editor's run and what viewers may see. Enforce the policy in `apps/web/lib/gen2/`, including every route that accepts a run, terminal, chat, or worktree ID. The current adapter verifies membership but does not consistently distinguish those actions by role or run owner.

Use one durable CoDev run ID with immutable workspace ID, creator, provider, credential connection ID, worktree ID, host workspace ID, host terminal ID, and lifecycle state. Keep lease and billing state in CoDev. Idempotency must compare the full launch identity, not just a key. Do not store profile contents or raw provider tokens in any run row.

**Exit:** Denial tests prove a viewer, former member, another workspace member without the required capability, and a caller substituting another run or worktree ID cannot launch, input, cancel, resume, or read unauthorized output.

### 2. Reuse a shared Superset launch core

Extract the smallest concrete shared operation from Superset's native agent launcher that both the native router and the CoDev bridge can call. Keep provider command/model validation, prompt framing, terminal creation, continuation checks, and worktree binding in that Superset-owned path. The CoDev entry point supplies an approved provider and per-launch private profile; it must not resolve `resolveDefaultAccountEnv`, host-global agent settings, or a desktop login. Retain the existing exact command gate until the shared path has an equally narrow policy.

Preserve Superset's registered-worktree resolution, including direct-child worktrees under `/workspace`, and reject mismatched workspace, worktree, and terminal IDs at the host boundary. Keep the agent and ordinary terminal on the same guest filesystem while their credential access differs.

**Exit:** One CoDev launch uses the Superset core; native Superset launch behavior still passes its existing tests; arbitrary commands, paths, environment keys, and worktree substitutions fail.

### 3. Make lifecycle hooks trustworthy on a headless guest

Provision the relevant Superset hook script and per-agent CLI configuration in the guest image or final launch profile, not in a host-wide member credential home. Ensure hooks work when the host starts under systemd without Electron. Authenticate or bind every CoDev lifecycle and subagent event to a launch and terminal before it can mutate `TerminalAgentStore`; a terminal ID alone is not proof. Keep hook delivery local to the guest, bounded, and free of credential material.

Connect the CoDev launch to Superset's existing binding persistence and terminal-exit path using genuine CLI events. Do not fabricate `Attached` or `Start` events to fill the UI. A missing hook should produce an explicit `unknown` status, with the PTY still tracked separately.

**Exit:** Real Codex and Claude launches populate the binding store; working, waiting, ended, and subagent events are attributable to the correct terminal; forged and cross-agent hooks are rejected. Verify this in a Firecracker guest, since upstream has documented headless hook-provisioning failures.

### 4. Make process and credential lifecycle restart-safe

Reconcile CoDev's durable run with Superset's terminal row and binding on host restart, guest restart, and VM restoration. Persist enough non-secret launch identity to prove that a recovered terminal belongs to the same CoDev workspace, worktree, provider, and run. Record actual exit codes where available; an unknown code must remain unknown. Expire stale idempotency mappings and release seats exactly once.

Remove private profile directories on natural exit, cancellation, failed start, daemon loss, and restart cleanup. Capture provider-refreshed credentials only into the launching member's CoDev connection, then remove the profile. Never silently restart an agent using an old profile. A resume candidate needs an explicit CoDev decision and freshly resolved credential. If identity or liveness cannot be proved, mark the run `recovery_required`.

**Exit:** Every failure path has one durable terminal state, no leaked profile, no duplicate process, and no held seat; tests cover interruption between each start/stop transition.

### 5. Expose safe concurrent agent sessions through CoDev

Provide CoDev APIs for list, start, input, poll, cancel, and recovery, backed by the same policy and run mapping. Use current snapshot polling initially. Define bounded output retention, sequence/cursor behavior, and a redaction policy before returning terminal text to browsers; a raw PTY snapshot is not a safe progress stream. Keep CoDev's chat messages and audit history durable without copying credential files or host administration state.

Create one worktree per independent writer and make the claim explicit. Allow shared-worktree concurrent writers only after a coordination policy exists. Keep files, editor, terminal, and Git scoped to the selected worktree; agent changes must appear through the existing file and Git reconciliation path.

**Exit:** Two members can launch independent agents in separate worktrees, observe both, switch worktrees, inspect changes, and cancel only runs their policy permits. Existing Gen 2 chat, file, terminal, Git, and sharing flows still work.

### 6. Add the Gen 2 agent UI, then evaluate chat migration

Show an agent roster in the current Gen 2 workspace with provider, worktree/branch, owner, trustworthy state, output, input, cancel, and `recovery_required`. Keep agent controls within the existing workspace design contract and shadcn/WorkspaceButton conventions. Show child subagents beneath their parent only after Phase 3 attribution is verified; their roster does not grant independent file or credential permissions.

After persistent sessions meet the same user needs as fresh turns, decide whether to replace the chat turn route, offer both modes, or keep chat fresh-turn while the agent roster provides persistent work. Do not switch the existing flag merely because a host agent can start.

**Exit:** Internal VM acceptance passes before broad rollout; no regression in current chat or workspace controls.

## Verification and rollout gates

1. **Focused code tests:** CoDev role and run policies, seat lifecycle, idempotency, output redaction, host command and profile validation, registered worktree resolution, binding hooks, and recovery transitions.
2. **Linux host suite:** PTY start/input/snapshot/exit, `tsx`-dependent tests with the loader configured, process and daemon loss, profile permissions, two isolated UIDs, and hook attribution.
3. **Gen 2 VM acceptance:** Codex and Claude; two agents in separate worktrees; viewer and cross-member denial; revoked connection; natural exit, cancellation, host restart, guest restart, hibernation/restoration; correct billing attribution and seat release.
4. **Release gate:** Resolve or explicitly baseline repository typecheck/lint/test failures. Enable the new capability only for an internal workspace, observe metadata-only starts, exits, recovery, profile cleanup, and seat durations, then widen the flag. Keep the current chat path as rollback until parity is proven.

## First implementation slice

Start with Steps 0 and 1, then implement a host-only vertical slice of Steps 2 and 3: one CoDev-authorized launch that uses the shared Superset launch core and produces a genuine persisted binding in a headless guest. The first review should include the denial tests and host tests, not a browser UI. This slice determines whether Superset's agent manager can be reused safely before adding more surface area.

## Handoff notes

- The integration branch is checked out at `C:\Users\qais4\.codex\worktrees\superset-agent-isolation\CoDev`; the primary checkout is on another branch with unrelated untracked files. Use the integration worktree explicitly.
- The merge commit is local and unpushed as of this handoff. The worktree has an untracked `apps/mobile/` directory; preserve it until its owner is known.
- Read `docs/README.md`, `docs/SUPERSET_AGENT_SESSION_PLAN.md`, `docs/SUPERSET_WORKSPACE_OWNERSHIP.md`, and the applicable `lib/` README before editing. The earlier session plan describes the existing flag-gated chat replacement; this handoff changes the rollout order, not CoDev's credential foundation.
- Do not run the web app before `pnpm db:check`. Use Node 24+ and `pnpm`. The full host PTY and Rust suites need Linux; no Gen 2 VM acceptance run has been completed for this integration.
