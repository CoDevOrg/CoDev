# Superset agent-session integration plan

**Status:** Design; begin only after the Superset terminal, Git, and worktree
bridge passes a real Gen 2 workspace smoke test. The `/superset` page—not the
legacy Gen 2 workbench—is that run's acceptance surface.
**Date:** 2026-09-27

## Objective

Replace the Gen 2 fresh-turn runtime (`codex exec` through `codev-guestd`) with
Superset terminal-agent sessions. CoDev continues to own identity, workspace
membership, provider connections, quotas, durable conversation history, and
recovery decisions. Superset owns the process and terminal lifecycle in the
selected worktree.

The initial provider is Codex. The launch contract must be provider-neutral so
Claude and later providers can use it without adding provider-specific fields to
the general session or worktree model.

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

- `apps/web/lib/gen2/agent.ts` already checks membership and instance state,
  resolves a Codex connection, claims a hosted-subscription execution, writes
  chat/turn records, and writes back a refreshed auth cache.
- `apps/web/lib/agents/cli-agent-session.ts` already has the durable CoDev
  `agent_sessions` and worktree registration pattern for CLI agents.
- `vendor/superset/packages/host-service/src/terminal-agents/` owns Superset's
  terminal-agent launch, monitoring, interruption, and host-side recovery.
- The flag-gated Superset runtime bridge already provides worktree selection
  and a private CoDev-to-host request path.

Do not keep a second agent process implementation in `codev-guestd`. Once the
new path is enabled, guestd validates fixed requests, manages the private
profile boundary, and forwards lifecycle operations to Superset.

## Phase 0: prove the prerequisite runtime

Before adding agent code, run the current terminal/Git/worktree smoke test in a
real Gen 2 VM with `CODEV_SUPERSET_RUNTIME_ENABLED=true`.

- Create an isolated worktree, open a shell in it, and verify status and diff.
- Confirm the shell uid is `codev-shell` and cannot read a running Codex
  credential profile.
- Confirm a viewer cannot create a worktree or bypass the route.
- Restart the host service and confirm terminal/worktree state has the intended
  recovery outcome.

Record the result in the adoption manifest. A failed prerequisite is a runtime
or image issue to fix before agent migration.

## Phase 1: define durable run identity

Use the existing CoDev `agent_sessions` row as the user-visible session. Add a
small Gen 2 Superset-run mapping rather than making Superset's SQLite database
the source of truth.

The mapping needs:

- CoDev workspace ID, CoDev agent-session ID, selected CoDev worktree ID, and
  requesting member ID.
- Superset host workspace ID, terminal ID, and terminal-agent session ID.
- Provider name, CoDev connection/credential ID, and a credential revision or
  fingerprint. Store no credential material in PostgreSQL mapping columns.
- Lifecycle state: `creating`, `running`, `stopping`, `finished`, `failed`, or
  `recovery_required`; timestamps; exit reason; and a bounded recovery count.
- The hosted-subscription claim/lease state so every terminal exit, cancel,
  failed start, and recovery path can release it exactly once.

Create a migration, Zod contract, repository functions, and audit events in
the normal `apps/web/lib/agents` and `packages/contracts` patterns. Use the
CoDev agent-session UUID for idempotency; retries must return the same active
run instead of starting another provider process.

## Phase 2: create a per-launch credential profile

CoDev resolves the requesting member's eligible provider connection and claims
its subscription lease before it asks the runtime to start an agent.

`codev-guestd` materializes one private profile for that run on the guest. It
contains only the provider files and environment required by that agent. The
profile must:

- be outside `/workspace` and outside Superset's shared home;
- have a random run-scoped directory, restrictive ownership and permissions,
  and no path exposed to the browser;
- be readable only by the agent process identity and the trusted guest/host
  launch path, never by ordinary terminal shells or other agent sessions;
- be removed after final credential capture, cancellation, failed launch, VM
  cleanup, or expired recovery window.

The guest should pass Superset a profile handle and approved launch environment,
not a raw credential payload in a general host request. Superset launches the
provider process with only that profile. Disable Superset default accounts and
all host-wide provider environment for these sessions.

Start with the existing Codex official auth-cache format. Define an internal
provider launch recipe interface containing the provider kind, executable,
arguments, sanitized environment names, profile handle, and refresh collector.
The recipe contains no secret in CoDev's durable run mapping or browser API.

## Phase 3: add fixed private Superset agent operations

Extend `vendor/superset/packages/host-service/src/codev/` with a narrow,
bridge-secret-protected agent endpoint set:

- `POST /codev/agents` starts an agent in a validated worktree from a private
  profile handle and returns host terminal/agent IDs.
- `POST /codev/agents/:id/input` sends approved interactive input when a
  provider flow needs it.
- `POST /codev/agents/:id/poll` returns bounded output, lifecycle state, and
  a refresh-ready signal. It never returns a profile file or secret.
- `DELETE /codev/agents/:id` stops the process and reports a terminal state.
- `GET /codev/agents/:id/recovery` reports whether the host can adopt an
  existing process after a service restart.

Use Superset terminal-agent APIs and terminal lifecycle functions internally.
Validate that every host session belongs to the requested CoDev worktree.
Do not expose generic command execution, arbitrary environment variables, or
arbitrary host URLs.

Add corresponding fixed routes in guestd, the orchestrator, and a server-only
CoDev runtime adapter. Extend the existing runtime feature flag with a separate
`CODEV_SUPERSET_AGENT_SESSIONS_ENABLED` flag so terminal/Git adoption can stay
independent during rollout.

## Phase 4: replace the Gen 2 agent route behind the flag

Keep the current `startGen2AgentTurn`, `pollGen2AgentTurn`, and
`cancelGen2AgentTurn` browser contract initially. Behind the new flag, change
their implementation flow to:

1. Check current membership, workspace state, chat access, agent-launch role,
   connection eligibility, and capacity before any runtime request.
2. Select or create an isolated agent worktree. Concurrent independent agents
   receive distinct worktrees and CoDev path claims.
3. Resolve the provider connection, claim its lease, create the durable mapping
   in `creating`, and materialize the private profile.
4. Start the Superset agent. Atomically store host IDs and move the mapping to
   `running`; append the user message and create the CoDev turn record.
5. Poll Superset through CoDev, reduce output into the existing durable turn
   records, and publish only CoDev-safe chunks to the browser.
6. On final exit, collect a refreshed provider cache through the trusted path,
   persist it with the existing encrypted connection store, release the lease,
   remove the profile, and mark the run terminal.

If startup fails after a lease claim, cleanup is mandatory: stop any host
process, remove the profile, release the claim, and record a failed run. Make
each cleanup step safe to repeat.

## Phase 5: refresh, cancellation, and recovery

Provider refreshes are captured only after the agent process has ended or at a
defined safe checkpoint. The guest reads the designated profile artifact,
returns it through the authenticated internal path, and CoDev validates and
encrypts it with the existing connection credential store. Never stream this
material to the browser, logs, chat transcript, or audit events.

Cancellation and role/connection revocation must stop the host process, remove
the profile, release the lease, and transition the durable run once. A member
who loses access can no longer poll, send input, or cancel another member's
session through a bypassed UI.

On host restart or VM restore, CoDev reconciles each nonterminal mapping with
Superset's recovery endpoint:

- Adopt a verified live host session with matching workspace, worktree, and
  host IDs.
- Mark a missing or ambiguous session `recovery_required`; do not silently
  relaunch it with a potentially stale credential profile.
- Let the member explicitly resume as a new run after CoDev resolves a fresh
  connection and creates a new private profile.

## Phase 6: browser integration

Adapt the Superset agent/session panel only after the host and CoDev paths are
working. The browser facade calls CoDev APIs and renders CoDev session IDs,
worktree/branch, redacted state, output, cancel, and recovery-required state.
It must not import Superset desktop authentication, local settings, or cloud
API clients.

Show worktree ownership and path claims clearly: agents on separate worktrees
can run concurrently; a shared human worktree requires an explicit exclusive
claim before an agent can write there.

## Verification gates

- Unit: role and connection denial precede all runtime calls; idempotent starts;
  lease release on every failure and terminal state; profile metadata never
  contains secrets.
- Host/guest: fixed routes reject malformed IDs, mismatched worktrees, raw
  profile contents, arbitrary environment, and arbitrary commands.
- Integration: two editors launch two Codex agents in separate worktrees; both
  outputs, branch status, and file reconciliation appear in the shared page.
- Isolation: an ordinary shell, a second agent, a viewer, and the browser each
  fail to read the first agent's profile or refreshed cache.
- Lifecycle: cancellation, provider revocation, host-service restart, and VM
  restoration each leave exactly one durable CoDev state and no held lease or
  leftover profile.
- Provider refresh: a controlled refresh writes back to the requesting
  member's connection only, then the profile is removed.

## Rollout and removal

Enable the agent-session flag only for an internal workspace after every gate
passes. Instrument starts, profile cleanup, lease duration, host adoption,
refresh success, and recovery-required outcomes using metadata only. Keep the
current `codex exec` route as a rollback path during this internal rollout.

Remove that fallback only after the Superset path has sustained real shared
workspace use, recovery has been exercised, and the ownership docs are updated
from Design to Current.
