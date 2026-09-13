# CoDev workspace consolidation

Status: first integration and reconnect phase implemented. The one-filesystem
Firecracker migration remains gated by the prototype and data-migration work below.

## Product decision

CoDev owns the editor, terminal, agent experience, and workspace lifecycle as one
product. Opening and developing a workspace should not require understanding a
separate Orca product. Preserve the hosted Vercel control plane and AWS execution
boundary while consolidating the workspace implementation behind it.

The desired result is one authoritative workspace filesystem, one execution
environment, and one lifecycle for editor, terminals, and agents. Independent
agent changes can use Git worktrees within that environment. A shared environment
does not imply unrestricted access to other members' credentials or permissions.

## What is already integrated

- `packages/ide` is CoDev's editable fork, with required upstream license notices.
- `infra/aws/scripts/build-orca-web.sh` and `build-orca-serve.sh` build the browser
  and runtime artifacts from that local source. Neither needs an upstream clone.
- The browser loads the IDE shell while the runtime connects.
- An existing Orca session can be reused by the orchestrator.

## Implemented in this change

- CoDev-specific browser preferences and hosted GitHub preflight behavior now live
  in `packages/ide`. The generated browser client no longer injects
  `codev-preload.js` or intercepts assignment of the IDE API.
- The browser paints the owned IDE shell before a workspace is ready, applies the
  saved light or dark theme immediately, and accepts the pairing payload later.
- The web control plane probes an already-running IDE session before waiting for
  AWS host state. The warm path still checks membership, quota, member credentials,
  and metering, and rejects failed session authorization.
- Warm reconnects no longer wait on the orchestrator's global provisioning lock.
  The idle reaper rechecks activity under the same lifecycle lock before stopping a
  session, which closes the reconnect-versus-reaper race.
- Workspace-open stages are exposed through `Server-Timing` without workspace IDs,
  credentials, or other values. This provides production measurement boundaries for
  authentication, authorization, lookup, quota, host/session, credentials, connect,
  and metering.
- The Linux artifact build repairs the non-executable pnpm `node-gyp` launchers and
  has a CI smoke test that exercises packaged terminal input/output and server
  readiness. Root commands now provide a documented entry point into the IDE's
  independent toolchain.

Local verification measured 5.826 seconds for the combined packaged Linux PTY and
server-readiness smoke test under an emulated x86_64 Apple container. That value is
artifact startup evidence, not browser workspace-open latency. The new timing
headers are the source for warm-open median and p95 measurements after preview and
production traffic exist.

The AWS README's description of building directly from a pinned upstream tag is
stale relative to these build scripts. Building two artifacts from one source
does not itself prevent deployed client/server version skew.

## Remaining seams and proposed ownership

| Current seam                                                                                        | Consolidation direction                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent page changes IDE DOM, injects theme/branding, and patches browser APIs                       | Move CoDev behavior into owned IDE source with explicit supported configuration; remove each external patch after equivalent behavior is verified |
| Web startup checks AWS and prepares multiple agent credentials before returning an existing session | Establish an authorized healthy-session reconnect path; make provider setup a prerequisite of agent launch rather than editor rendering           |
| IDE and backend agents operate on separate filesystems                                              | Prototype the IDE runtime inside the workspace microVM; migrate consumers to one authoritative filesystem only after isolation and recovery pass  |
| Independent IDE and sandbox lifecycle/heartbeat semantics                                           | Have one workspace runtime authority for readiness, activity, suspension, recovery, and metering                                                  |
| Browser and server artifacts deploy independently                                                   | Record matching build/protocol versions and support a tested compatibility window during rollout                                                  |
| Separate IDE tools and root tools                                                                   | Provide explicit root entry points for IDE development and targeted checks, retaining its isolated dependency graph initially                     |

Keep `packages/ide` excluded from root recursive pnpm and formatting operations
under the current repository rules. A convenient top-level command can delegate
to that package without merging its Electron dependencies into the web app.

## Implementation sequence

### 1. Establish evidence and optimize reconnection

Measure browser navigation, authorization, host readiness, credentials, session
lookup/start, pairing, editor editability, and first terminal command. Separate
running-session, new-process, suspended-workspace, stopped-host, and new-repository
cases. Report median and p95 latency with errors, not just successful openings.

Start from `apps/web/lib/orca-host.ts`, `apps/web/lib/host.ts`,
`apps/web/components/orca-workspace.tsx`, and
`services/orchestrator/src/backend/orca.rs`.

Preserve membership checks, quotas, and fresh scoped connection authorization on
every reconnect. Do not serve stale pairing credentials from a shared cache.
Provider preparation must complete before the corresponding agent launches and
must retain per-member identity. Metering must remain durable when moved off the
response path.

Continue investigating the 2.5-second browser retry cadence, eight-second shell
fallback, and recursive ownership setup. The global provisioning mutex was proven
to block unrelated warm reconnects and has been removed from that path; it remains
around capacity and routing mutations.

### 2. Make the existing IDE an ordinary CoDev component

Move supported integration behavior from `infra/aws/orca-build/codev-preload.js`,
`brand-web.mjs`, and parent DOM manipulation into the relevant IDE modules.
Use validated, versioned messages for session, member, permissions, readiness, and
theme. Retain useful module and browser isolation boundaries; removing an iframe
alone is neither a security nor a performance solution.

Make source edits visible through a documented local development loop using the
IDE's existing development tooling. Keep production bundling reproducible and
include required generated browser assets in the same change as IDE source.
Run both repository design skills for interface implementation changes.

### 3. Prove one isolated runtime

Run the existing IDE backend, terminal processes, and agent tooling inside a
Firecracker workspace VM in a prototype. Verify Electron/virtual-display support,
memory, networking, filesystem watching, PTYs, and real agent execution before
choosing whether a headless runtime extraction is necessary.

Keep code execution isolated from the AWS host and other workspaces. Apply resource
limits and restrict infrastructure network access. Enforce member capabilities at
runtime operations, not only when rendering buttons. Explicitly test that terminal
access does not expose another member's provider credentials; separate credential
directories under the same OS user are not a security boundary.

Prototype failure is a reason to revise the runtime implementation, not to move all
backend execution onto the shared host or silently weaken isolation.

### 4. Migrate data and lifecycle together

Inventory file, Git, worktree, agent, publication, history, resume, collaboration,
heartbeat, and billing consumers before switching routes. Maintain the current
`/ide` versus sandbox routing distinction until a workspace is explicitly migrated.

Quiesce writes, capture committed and uncommitted files (including untracked files),
and reconcile the two existing roots without overwriting either. Validate the copy
and switch a versioned runtime assignment atomically. Never allow old and new
environments to accept writes for the same workspace concurrently.

Keep durable storage/backups independent of disposable host replacement. Prove
recovery after a process crash and a host loss. Rollback after new writes requires
a reverse data migration or forward recovery, not merely changing the routing flag.
Retire old routes and processes after all consumers have moved and rollback needs
are addressed.

### 5. Tune warmth and resume against a budget

Keep recent sessions available for a bounded period. Use observed demand and a
compute budget to choose warm host capacity; do not silently increase production
spend. Longer-term suspend/resume must reestablish connections, refresh appropriate
authorization, and protect snapshots containing private state. Shared prepared
base images must contain no customer secrets or workspace data.

## Acceptance criteria

These are performance targets. The shell behavior and reconnect concurrency now
have automated coverage; end-to-end warm-open latency has not yet been measured in
the deployed environment and is not a current guarantee:

- Workspace shell visible in under one second under the agreed test conditions.
- Running workspace usable at p95 within 1.5 seconds on the reference connection.
- Suspended workspace usable on a warm host at p95 within three seconds, subject
  to prototype results; measure stopped-host starts separately.
- Editor, terminal, and backend agent observe the same saved change in the same
  selected worktree; parallel agent worktrees remain intentionally distinct.
- Concurrent opens create one environment per workspace without starving unrelated
  reconnects or exceeding capacity.
- Disconnect/reconnect preserves running work and does not duplicate billing.
- Permission revocation, viewer restrictions, cross-workspace access, and member
  credential separation pass end-to-end tests.
- Save, agent change, review, publication, suspension, and recovery pass together.
- A normal CoDev IDE change needs an owned source edit and documented checks,
  without introducing another post-build patch or parent DOM workaround.

## Scope of the decision

Consolidation is substantive integration of code ownership, contracts, state, and
execution. Keep the existing working IDE capabilities and upstream attribution.
Wholesale renaming, merging every process, replacing the editor, or removing
isolation are not prerequisites. Runtime migration remains an engineering task
with the prototype and migration gates above.
