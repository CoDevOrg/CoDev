# Superset agent-session integration plan

**Status:** In progress. Phases 0–1 are done. Phase 2's provider-neutral
credential delivery is implemented on `codex/superset-agent-isolation` and needs
end-to-end verification. Phase 3's Codex fallback and credential isolation are
production-verified; its remaining lifecycle and end-to-end access-control
verification gates are open.
Phases 4–5 remain unverified or partial. Phase 6 (browser panel) is not started.
**Date:** 2026-09-27 (design) · 2026-09-30 (status update)

**Implementation sequencing update (2026-10-02):** See
[`SUPERSET_MULTI_AGENT_HANDOFF.md`](./SUPERSET_MULTI_AGENT_HANDOFF.md). Prove
independent persistent agents in separate worktrees before replacing Gen 2's
fresh-turn chat contract. Keep the existing chat path available during rollout.

## Objective

Replace the Gen 2 fresh-turn runtime (`codex exec` through `codev-guestd`) with
Superset terminal-agent sessions. CoDev continues to own identity, workspace
membership, provider connections, quotas, durable conversation history, and
recovery decisions. Superset owns the process and terminal lifecycle in the
selected worktree.

The launch contract is provider-neutral. Codex was first; Claude and later
providers use the same contract without adding provider-specific fields to the
general session or worktree model.

## Scope guard: the credential foundation is frozen

The provider-credential work on `main` (commits `9b20b08bc8` → `b641b8de38`,
10 commits, migrations `0058`–`0062`) is the source of truth for how
credentials are resolved, leased, scoped and delivered to the guest. **This plan
consumes it and does not change it.** Nothing in this plan may:

- add, replace, or bypass `resolveCredential` (readiness stays the same walk
  with `dryRun`) or add a second resolver or readiness shape;
- add per-provider capability exceptions outside `registry.ts`;
- change the lease model (run-derived seats with heartbeats; executors wait
  rather than refuse), the `allow_in_shared_workspaces` enforcement, or the
  single `WORKSPACE` scope;
- reintroduce `sharing_enabled`, per-member login snapshots, or a second Claude
  login path (`claude_connection_sessions` and the subprocess login backend stay
  as they are);
- alter the settings surface (one card per account) or add DB columns/migrations
  to the credential tables.

If a phase below appears to need one of those, the plan is wrong, not the
foundation: adding a provider is a registry entry plus a loader in `resolve.ts`,
and this plan should fit inside that. Stop and raise it instead of editing the
foundation.

### What the foundation already provides (done, outside the original plan)

| Area           | Before                                                | Now                                                                              |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Resolution     | 3 resolvers + a UI table                              | one `resolveCredential`; readiness is the same walk with `dryRun`                |
| Capability     | hand-maintained per-provider exceptions               | `registry.ts`: one table keyed by credential kind                                |
| Surface flags  | 2 columns read on 1 path of 3                         | `allow_in_shared_workspaces`, enforced everywhere                                |
| Leases         | 16-min stamp, no reaper; Gen 2 ignored it             | run-derived seats with heartbeats; every executor waits rather than refusing     |
| Shared scope   | `WORKSPACE` and `ORGANIZATION` meaning the same thing | one `WORKSPACE` scope; `sharing_enabled` deleted                                 |
| Claude         | two logins, one in a per-member VM snapshot           | one setup-token; ephemeral sandboxes; runs in rooms, workspaces and Gen 2        |
| Guest contract | `codexAuthCacheJson` by name                          | neutral launch profile (files + env); legacy field still sent for rollout safety |
| Settings       | two surface tabs × three providers                    | one card per account, stating where it runs                                      |

Known open items owned by that work, not by this plan:

- `bedrock` and `azure_foundry` remain supported provider values for members'
  own credentials and model-provider configuration.
- Gen 2 still sends both `launchProfile` and legacy `codexAuthCacheJson`.
  Dropping the legacy field is a one-line change once rollout is confirmed. It
  is a dependency of this plan's secrecy goal (see Rollout), but the change
  itself belongs to the credential work.
- Member env vars are silently ignored on a guest image that predates the launch
  profile.

## Required boundary

```text
Browser
  -> CoDev agent route: membership, role, connection, quota, audit
    -> CoDev database: durable run and worktree mapping
      -> orchestrator -> codev-guestd
        -> one private profile for this launch
          -> Superset host terminal-agent session in one worktree
            -> process output and terminal lifecycle events
        <- profile refresh / final state
      <- CoDev persists transcript, metering, and refreshed connection state
```

The browser sees CoDev session identifiers and redacted progress only. It never
sees host bridge credentials, a provider auth cache, profile paths, or a
Superset administrative endpoint.

## Existing pieces to retain

- `apps/web/lib/gen2/agent.ts` checks membership and instance state, resolves a
  connection via `resolveCredential`, claims a run-derived seat, writes
  chat/turn records, and writes back refreshed credential state.
- `apps/web/lib/agents/cli-agent-session.ts` has the durable CoDev
  `agent_sessions` and worktree registration pattern for CLI agents.
- `vendor/superset/packages/host-service/src/terminal-agents/` owns Superset's
  terminal-agent monitoring and interruption.
- The flag-gated Superset runtime bridge provides worktree selection and a
  private CoDev-to-host request path.

Do not keep a second agent process implementation in `codev-guestd`. Once the
new path is enabled, guestd validates fixed requests, manages the private
profile boundary, and forwards lifecycle operations to Superset.

## Phase status

| Phase                                            | Status                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| 0. Prerequisite runtime                          | **Done**                                                                       |
| 1. Durable run identity                          | **Done**                                                                       |
| 2. Per-launch credential profile                 | **Host delivery implemented on this branch; needs end-to-end verification**    |
| 3. Fixed private Superset agent operations       | **Isolation verified; profile delivery and exit cleanup need VM verification** |
| 4. Replace the Gen 2 agent route behind the flag | **Implemented, unverified**                                                    |
| 5. Refresh, cancellation, recovery               | **Partial**: reconciliation exists; host recovery is a liveness check only     |
| 6. Browser integration                           | **Not started**                                                                |

## Phase 0: prove the prerequisite runtime — DONE

The terminal/Git/worktree smoke test was run in a real Gen 2 VM with
`CODEV_SUPERSET_RUNTIME_ENABLED=true` and passed. Worktree creation, shell in
worktree, status/diff, `codev-shell` uid isolation, viewer denial, and host
restart recovery were covered.

## Phase 1: define durable run identity — DONE

The existing CoDev `agent_sessions` row is the user-visible session. A small
Gen 2 Superset-run mapping (`gen2SupersetRuns`, `apps/web/lib/gen2/superset-runs.ts`)
holds the Superset host IDs, lifecycle state (`creating`, `running`,
`stopping`, `finished`, `failed`, `recovery_required`), bounded recovery count,
and timestamps. It stores no credential material. The CoDev agent-session UUID is
the idempotency key. Lease state is not duplicated here: seat lifecycle is owned
by the foundation's run-derived seats.

## Phase 2: per-launch credential profile — HOST WIRING IMPLEMENTED, UNVERIFIED

The foundation's neutral launch profile (files + env) exists and is produced from
`resolveCredential` and the registry entry for the credential kind. guestd
validates it (`validate_launch_profile`) and the web adapter sends it.

Commit `73d606ed27` adds `launchProfile` to the Superset host start schema. The
host validates its file and environment limits, materializes files in the
existing per-agent private directory, expands `{{profileDir}}` only in the
agent's launch script, and passes the environment without putting it on the
command line. The legacy Codex cache remains a compatibility fallback for an
older control-plane rollout; a supplied launch profile takes precedence.

The host is deliberately profile-driven: it does not need a provider-specific
credential field to launch Claude, Codex, or a later provider. Codex and Claude
still need end-to-end VM tests before this phase is complete.

## Phase 3: fixed private Superset agent operations — PARTIALLY VERIFIED

`vendor/superset/packages/host-service/src/codev/agents.ts` (commit
`841ab3923b`), bridge-secret protected, registered in `app.ts`:

- `POST /codev/agents`: start in a validated worktree.
- `POST /codev/agents/:id/input`: bounded interactive input.
- `POST /codev/agents/:id/poll`: terminal snapshot, lifecycle state, and a
  refresh-ready signal; the snapshot has no redaction.
- `DELETE /codev/agents/:id`: stop and report terminal state.
- `GET /codev/agents/:id/recovery`: liveness check.

Matching fixed routes exist in guestd (`/v1/superset-agents`), the orchestrator,
and a server-only CoDev adapter. Gated by `CODEV_SUPERSET_AGENT_SESSIONS_ENABLED`,
separate from the terminal/Git flag.

**Design reality that differs from the original plan:** Superset's
`TerminalAgentBinding` is populated by hook events from an agent CLI running in
a tracked terminal; there is no headless launch primitive. The implementation
therefore reuses the terminal primitives the `/codev/terminal` routes use and
delivers the agent command as `initialCommand` in a live shell, with each
argument POSIX-single-quote-escaped. The credential and a short launch script
are written to a fresh 0700 directory below `/var/lib/codev-agent-profiles`,
never under `/workspace`. The agent runs with a distinct numeric UID while
sharing the workspace-writing group with ordinary terminals. Commit
`1477b6115f` removes the private directory after a natural terminal exit and
reports the PTY exit code while the host process remains live. It does not fake
hook-based `TerminalAgentStore` tracking.

### Current findings (2026-09-30)

The five targeted web suites pass (39 tests, including the credential-profile
tests), `pnpm typecheck` passes, and the full web suite passes (1247 tests; one
skipped). The root `pnpm test` stops in two infrastructure tests that invoke
Bash through Windows paths, before running the package suites. No test exists
for `agents.ts`. The orchestrator's Rust tests were not run on this Windows
machine, which has neither cargo nor bun.

**Status accounting for future updates:** treat the code on `main` as the
source of truth. Commit `99fe5c5fe1` fixed the shared-UID and long-command
staging defects, and merge `713eac2bdc` brought it onto `main`. Commits
`e2802bdf49`, `efe7ae5f6b`, and `32fc5cf650` made Gen 2's web-side provider
selection, command construction, and output parsing provider-aware. Commits
`73d606ed27` and `1477b6115f` on this branch deliver `launchProfile` to the
Superset host and clean up profiles after a live host observes terminal exit.
Refresh capture and durable exit codes across a host restart remain open. Commit
`72d4894eb1` adds host-memory agent/worktree records and exact Codex and Claude
command gates; their VM and restart behavior still need evidence. Do not mark
those items complete without new code and end-to-end evidence.

1. **Codex credential isolation is verified.** Commit `99fe5c5fe1` creates a
   root-owned, searchable profile root and a distinct 0700 directory and UID
   per agent. The launch script belongs to that UID and is sourced as a short
   initial command, avoiding Superset's inaccessible long-command staging. In
   production, a ChatGPT-connected Codex agent created files successfully while
   an ordinary workspace terminal received `permission denied` when attempting
   to inspect `/var/lib/codev-agent-profiles`.
2. **Provider-neutral host delivery is implemented but unverified.** The host
   now accepts a launch profile and gives its files and environment only to the
   isolated process. Codex and Claude launches need a real-VM acceptance test.
3. **The terminal snapshot is not a redacted progress stream.** The launch
   script keeps credentials, the prompt, and history out of the echoed command,
   but the browser still receives the terminal snapshot. The sourced script path
   and anything an agent prints can appear there, so profile paths and provider
   output need an explicit redaction policy before broad rollout.
4. **Exit-code durability is incomplete.** `/poll` returns the real PTY exit
   code while this host process remains live. After a host restart the terminal
   row records only that it ended, so the exit code is null rather than durable.
5. **No refresh capture.** `refreshReady` is set but nothing reads the refreshed
   cache back, so the provider-refresh write-back is unimplemented.
6. **Profile cleanup needs restart coverage.** The host removes the directory
   on failed start, DELETE, and a natural exit it observes. A host restart before
   that callback still needs a cleanup/reconciliation strategy.
7. **Host-side identity checks are implemented but not durable.** `/input`,
   `/poll`, `DELETE`, and `/recovery` now require an in-memory agent record and
   verify its terminal's host workspace before acting. A host restart rejects
   rather than adopts an unknown agent ID, so durable recovery remains open.
8. **Arbitrary commands are rejected.** The host accepts only the exact Codex
   and Claude shapes Gen 2 produces; quoting remains a second defense. The
   command gate needs a real host/guest test.
9. **Unconfirmed:** a 4096-column terminal may wrap long `codex exec --json`
   lines and corrupt JSON parsing. The idempotency map is host-memory only;
   repeated keys are checked against worktree and provider while the host lives,
   but that check is not restart-safe.

Remaining verification: Codex and Claude launches, two concurrent agents,
cross-agent access denial, natural-exit cleanup, and the worktree/command gates
in a real VM and after a host restart.

## Phase 4: replace the Gen 2 agent route behind the flag — IMPLEMENTED, UNVERIFIED

`startGen2SupersetAgentTurn`, `pollGen2SupersetAgentTurn`, and
`cancelGen2SupersetAgentTurn` (`apps/web/lib/gen2/superset-agent-runtime.ts`)
keep the existing browser contract; `recordGen2SupersetRunOutput` (`turns.ts`)
reduces Superset's whole-buffer polls into the durable turn records. Flow behind
the flag:

1. Check membership, workspace state, chat access, agent-launch role,
   connection eligibility (via `resolveCredential`), and capacity before any
   runtime request.
2. Select or create an isolated agent worktree with distinct CoDev path claims.
3. Claim the seat, create the mapping in `creating`, and send the resolved
   launch profile to guestd.
4. Start the Superset agent; store host IDs and move to `running`; append the
   user message and create the turn record.
5. Poll through CoDev and publish only CoDev-safe chunks.
6. On final exit, release the seat and mark the run terminal. The host removes
   an observed run's profile; refresh capture and restart-safe cleanup remain
   open Phase 5 work.

Startup failure after a claim must stop any host process, remove the profile,
release the seat, and record a failed run, each step safe to repeat.

Remaining: confirm the flag switches the whole path end to end in a real Gen 2
VM, and that every failure branch releases the seat exactly once. Blocked on the
Phase 3 findings, notably VM verification, durable exit codes, restart-safe
profile cleanup, and restart-safe agent-record recovery.

## Phase 5: refresh, cancellation, and recovery — PARTIAL

Exists: `reconcileGen2SupersetAgentSession` moves a missing or ambiguous
nonterminal run to `recovery_required` and increments the bounded recovery
count. Refresh state is not yet captured from the Superset host, even though
the web-side credential store has the existing encrypted write-back path.

Gap: the host `/recovery` endpoint is a liveness check against the terminal
session, not resume-candidate tracking, so adoption after a host restart can
only confirm a live terminal, not resume agent state. A missing or ambiguous
session is marked `recovery_required` and never silently relaunched with a stale
profile; the member resumes as a new run with a freshly resolved credential.

Remaining: cancel and revocation exercised end to end; a former member cannot
poll, input, or cancel another member's session through a bypassed UI.

## Phase 6: browser integration — NOT STARTED

Adapt the Superset agent/session panel only after phases 3–5 are verified. The
browser facade calls CoDev APIs and renders CoDev session IDs, worktree/branch,
redacted state, output, cancel, and recovery-required state. It must not import
Superset desktop authentication, local settings, or cloud API clients. Show
worktree ownership and path claims: agents on separate worktrees run
concurrently; a shared human worktree needs an explicit exclusive claim before an
agent can write there.

## Verification gates

Status of each gate is unconfirmed unless noted.

- Unit: role and connection denial precede all runtime calls; idempotent
  starts; seat release on every failure and terminal state; profile metadata
  never contains secrets. (Partial unit coverage exists in
  `superset-agent-runtime.test.ts` and `superset-runs.test.ts`.)
- Host/guest: fixed routes must reject malformed IDs, mismatched worktrees, raw
  profile contents, arbitrary environment, and arbitrary commands. The host now
  has an in-memory worktree record and exact launcher policy; verify every
  rejection and the conservative host-restart behavior in a real VM.
- Integration: two editors launch two agents in separate worktrees; outputs,
  branch status, and file reconciliation appear in the shared page.
- Isolation: the ordinary-shell check is verified in production. A second
  agent, a viewer, and the browser still need to be shown unable to read the
  first agent's profile or refreshed cache.
- Lifecycle: cancellation, provider revocation, host-service restart, and VM
  restoration each leave exactly one durable CoDev state, no held seat, and no
  leftover profile.
- Provider refresh: a controlled refresh writes back to the requesting member's
  connection only, then the profile is removed.
- Providers: run the gates for Codex and Claude. The host receives provider
  credentials only through `launchProfile`; both providers need real-VM proof.

## Rollout and removal

Enable the agent-session flag only for an internal workspace after every gate
passes. Instrument starts, profile cleanup, seat duration, host adoption,
refresh success, and recovery-required outcomes using metadata only. Keep the
current `codex exec` route as a rollback path during the internal rollout.

Before wider rollout, the credential work should confirm the guest image rollout
and drop the legacy `codexAuthCacheJson` field, so no auth cache travels in a
general host request. This plan only depends on that; it does not perform it.

Remove the `codex exec` fallback only after the Superset path has sustained real
shared-workspace use, recovery has been exercised, and the ownership docs are
updated from Design to Current.
