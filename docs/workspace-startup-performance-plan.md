# Workspace startup performance plan

Status: Phase 1 in progress. The implemented slice is called out below; the
remaining phases are still design work.

## Objective

Make a CoDev workspace feel available immediately and make its editor,
terminal, Git operations, and agents genuinely usable much faster.

The work has two tracks:

1. Remove avoidable latency from the current Azure host and Orca startup path.
2. Replace the per-workspace Electron backend with a lightweight headless
   workspace gateway, while preserving the existing browser editor and its
   capabilities.

The target is a static browser shell served quickly from Vercel, backed by a
pool of prepared Azure hosts. Each active workspace eventually runs in an
isolated Firecracker microVM containing one authoritative workspace filesystem
and a small gateway for files, Git, terminals, and agents.

## Current architecture and bottlenecks

### Capacity model

The deployment currently creates one shared Azure VM for all users. It is not
one VM per user or workspace. The host is currently a `Standard_D2s_v7` and is
configured for at most:

- four concurrent Orca IDE sessions;
- two concurrent Firecracker sandboxes;
- a ten-minute IDE idle timeout; and
- a ten-minute host idle timeout before deallocation.

See [`infra/azure/main.bicep`](../infra/azure/main.bicep) and
[`infra/runtime/scripts/bootstrap-host.sh`](../infra/runtime/scripts/bootstrap-host.sh).

This design makes the first open after an idle period pay for Azure VM startup,
host bootstrap, orchestrator health, and workspace process startup. One host is
also a capacity ceiling and a single point of failure.

### Current workspace-open path

The dashboard's prewarm calls the full Orca endpoint. The same endpoint is
called again by the workspace page. A cold or absent session can perform all of
the following:

1. Authenticate and authorize the member.
2. Check workspace compute quota.
3. Probe the orchestrator for an existing IDE session.
4. Discover and wake the Azure host.
5. Wait for the orchestrator to become healthy.
6. Resolve several member provider credentials.
7. Clone the repository if it is absent.
8. Create a workspace Linux user.
9. Kill stale processes owned by that user.
10. Recursively change repository ownership.
11. Write agent configuration and credentials.
12. Launch a full Electron-derived `orca serve` process.
13. Wait for its WebSocket readiness line.
14. Update Caddy routing and return a pairing offer.

Relevant entry points are:

- [`apps/web/components/workspace/workspace-grid.tsx`](../apps/web/components/workspace/workspace-grid.tsx)
- [`apps/web/components/workspace/orca-workspace.tsx`](../apps/web/components/workspace/orca-workspace.tsx)
- [`apps/web/app/api/workspaces/[workspaceId]/orca/route.ts`](../apps/web/app/api/workspaces/%5BworkspaceId%5D/orca/route.ts)
- [`apps/web/lib/runtime/orca-host.ts`](../apps/web/lib/runtime/orca-host.ts)
- [`services/orchestrator/src/backend/orca.rs`](../services/orchestrator/src/backend/orca.rs)

### Orca server weight

The browser UI is already emitted as static assets and is mounted before the
runtime pairs. The expensive remote component remains a full Electron
application packaged as an AppImage. It still initializes much of the desktop
composition root, requires an X display supplied by Xvfb, and starts one process
tree per workspace.

That is more machinery than a hosted workspace requires. The hosted runtime
principally needs:

- authenticated WebSocket transport;
- file read, write, watch, and search;
- Git and worktree operations;
- PTY creation and streaming;
- agent launch and status;
- port forwarding; and
- session persistence.

The browser editor should be retained initially. The redesign should remove
Electron from the hosted backend instead of replacing the whole editor at once.

### Repository work

The repository clone is correctly skipped when `.git` already exists. The
clone persists across a deallocate/start cycle on the same VM, but it is stored
on the replaceable host disk and is lost when that VM is replaced.

Every newly started Orca session also runs recursive ownership repair over the
repository. This cost grows with repository size even when ownership is already
correct.

### Split execution environments

Today the Orca IDE session and the Firecracker sandbox are separate execution
contexts with separate disks. Files created in one are not automatically
visible in the other. The long-term design must converge editor, terminal, Git,
interactive agents, and backend-driven execution onto one authoritative
workspace filesystem without weakening isolation.

## Target architecture

```text
Dashboard intent
    |
    +--> POST /wake -------------> Runtime scheduler
    |                                  |
    |                                  v
Navigation                    Prepared Azure host pool
    |
    +--> Static IDE shell from Vercel/CDN
    |
    +--> POST /workspace-session
              |
              v
       Durable start operation
              |
              +--> Assign a warm host
              +--> Attach or restore workspace storage
              +--> Start workspace gateway
                          |
                          v
                 Per-workspace Firecracker VM
                +-----------------------------+
                | Headless workspace gateway  |
                | Git, files, watchers, PTYs   |
                | Agents and port forwarding   |
                | One workspace filesystem     |
                +-----------------------------+
                          |
                          v
                  Durable workspace storage
```

The target is a shared pool of Azure hosts, not one Azure VM per user. An active
workspace receives an isolated microVM on one host. This is more efficient than
per-user VMs while providing a real boundary between workspaces.

## Phase 0: establish a performance baseline

Extend the existing `Server-Timing` instrumentation into an end-to-end
workspace-open trace. Record:

- navigation start;
- first static-shell paint;
- wake accepted;
- Azure host running;
- orchestrator healthy;
- workspace storage ready;
- repository ready;
- gateway or Orca process started;
- pairing complete;
- repository tree usable;
- first terminal prompt; and
- first successful editor save.

Report p50, p95, error rate, and sample count separately for:

- an already-running session;
- a stopped session on a warm host;
- a deallocated host;
- a new repository;
- an existing repository;
- a representative large repository; and
- concurrent opens at and above capacity.

Persist client timing rather than relying only on response headers. Existing
Orca startup milestones should be correlated with the workspace-open trace.

Exit criterion: each major interval in the open path is measurable in preview
and production, with workspace and credential values excluded from telemetry.

## Phase 1: split wake, prepare, and session start

### Implemented slice

The first Phase 1 slice now includes:

- `POST /api/workspaces/:workspaceId/wake`, which authenticates and wakes only
  the shared Azure host;
- in-process deduplication of concurrent Azure wake calls, with Azure still
  handling convergence across separate web processes;
- dashboard hover/focus wake intent with a short delay and one request per
  workspace per dashboard session;
- dashboard pointer-down preparation through
  `POST /api/workspaces/:workspaceId/prepare`;
- an idempotent orchestrator preparation endpoint that creates the workspace
  directory and clones the repository without starting Orca; and
- preparation-side tests that prove provider-agent credentials are not
  resolved before the workspace process starts.

The existing `/orca` route remains the authoritative session-start path while
this slice is measured. Its Rust provisioning lock already serializes a
preparation and a start for the shared host, and its session lookup keeps
repeated starts idempotent. A durable web-level operation/status resource is
still required before removing the existing polling path.

### Lightweight wake endpoint

Add `POST /api/workspaces/:workspaceId/wake`.

It should:

- authenticate and verify membership;
- wake the assigned host or request scheduler capacity;
- deduplicate concurrent host wake requests;
- return immediately; and
- never clone, resolve provider credentials, start Orca, or mint pairing data.

Trigger it from hover intent, keyboard focus, and pointer-down. A short hover
delay should avoid waking compute for accidental pointer movement.

### Workspace preparation endpoint

Add an idempotent preparation operation that can:

- reserve or assign host capacity;
- ensure durable workspace storage exists;
- attach or restore that storage;
- clone the repository when needed; and
- leave the workspace ready for a gateway start.

Run preparation after workspace creation, on strong navigation intent, and for
recently used workspaces when the compute budget allows. Preparation must not
resolve personal agent credentials.

### Durable session operation

Replace repeated full POST attempts with one idempotent start request and a
durable status resource. Suggested states are:

```text
requested
host-assigned
host-starting
storage-attaching
repository-preparing
gateway-starting
ready
failed
```

Only one start operation may own a workspace generation. Concurrent requests
must join the same operation instead of duplicating clone, process, route, or
metering work.

Use short status polling or a supported event stream. If polling is retained,
poll quickly during the first few seconds and then back off with jitter. Do not
repeat credential resolution and other expensive open work on every status
request.

Exit criterion: dashboard intent can start host work before navigation without
starting a workspace process, and concurrent opens converge on one operation.

## Phase 2: remove synchronous per-open work

### Eliminate normal recursive ownership repair

Change repository creation to:

1. Create the workspace Linux user first.
2. Create the destination with the final UID and GID.
3. Run `git clone` as that user.
4. Track ownership migration state outside the repository.
5. Run a one-time repair only when ownership is proven incorrect.

Keep narrow ownership changes for small credential and configuration
directories. Do not remove those blindly.

### Defer provider credentials

Opening an editor should not depend on Codex, Claude, Cursor, or API-key
resolution. Resolve a member's credential when that member launches the
corresponding agent. Inject it into the child process instead of making it a
prerequisite for workspace rendering.

This should also replace the current attribution-only arrangement with a
credential broker that does not leave one member's secret readable from a
shared workspace home.

### Remove metering from response latency

Record session-open metering through a durable event or outbox. A metering
write failure must not delay or fail workspace readiness, and retries must not
double-bill.

### Repository clone policy

Continue preserving full Git semantics by default. Do not enable shallow clone
globally because it can break history and worktree operations. Benchmark
`--filter=blob:none --single-branch` on large repositories and adopt it only if
agent and Git workflows pass the complete acceptance suite.

Exit criterion: a normal existing-repository open performs no repository-wide
ownership walk and no provider credential resolution.

## Phase 3: build a preconfigured Azure image

Create an Azure Compute Gallery image through an automated image-build
pipeline. Bake stable host dependencies into the image:

- Linux packages;
- Node.js 24;
- Firecracker and kernel prerequisites;
- the prepared guest root filesystem;
- Caddy;
- network-isolation setup;
- service units; and
- monitoring prerequisites.

Until the headless gateway ships, the transitional image may also include the
current Orca runtime dependencies and Xvfb.

Never bake:

- credentials or tokens;
- TLS private keys;
- workspace repositories;
- member state;
- deployment-specific public hostnames; or
- runtime bearer secrets.

Boot-time work should be limited to mounting disks, retrieving environment
configuration, installing a small versioned release artifact, configuring
routing, starting services, and reporting health.

The pipeline must publish versioned image definitions, run nested-virtualization
and workspace smoke tests, support draining old hosts, and retain a tested
rollback image.

Microsoft documents Azure Compute Gallery custom images as the supported way to
preload applications and configuration, with Azure VM Image Builder available
to automate image creation:
[Azure custom VM images](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/tutorial-custom-images).

Exit criterion: replacing a host does not run package installation, build the
guest rootfs, or download and extract the full runtime during its readiness
path.

## Phase 4: introduce a warm multi-host scheduler

Use Azure Virtual Machine Scale Sets with Flexible orchestration and a prepared
image. Maintain two durable registries similar to:

```text
runtime_hosts
- host_id
- lifecycle_state
- free_workspace_slots
- image_version
- last_heartbeat_at
- draining_at

workspace_runtime_assignments
- workspace_id
- host_id
- generation
- fencing_token
- disk_id
- runtime_state
- last_used_at
```

Scaling policy should use queued workspace starts and available slots rather
than CPU alone:

- keep at least one running host during agreed active hours;
- optionally scale to zero during low-use periods while the product is small;
- add capacity before all current hosts are full;
- optionally maintain one spare prepared host when demand justifies its cost;
- drain hosts before image replacement; and
- never move a writable workspace without a generation/fencing transition.

Every browser pairing offer must route to the workspace's assigned host. Use a
host-specific runtime address with short-lived signed pairing, or a routing
layer that resolves workspace assignment before proxying the WebSocket. The
orchestrator API itself must remain private.

Azure recommends Flexible orchestration for scalable groups of standard VMs
and supports autoscale and standby pools:

- [VM Scale Set orchestration modes](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-orchestration-modes)
- [VM Scale Set standby pools](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/standby-pools-overview)

Do not make VM hibernation a prerequisite. Validate the exact OS, SKU, nested
virtualization, and Firecracker combination first. Current Azure Linux
hibernation guidance lists specific supported distributions and should be
treated as a separate experiment:
[Azure Linux hibernation](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/hibernate-resume-linux).

Exit criterion: one host can be drained or lost without making every workspace
unavailable, and queued demand can cause additional prepared capacity to join.

## Phase 5: preserve workspace state outside disposable hosts

Benchmark two storage designs before selecting one:

1. A managed disk per workspace, attached read-write to exactly one host at a
   time and presented to its Firecracker VM.
2. Fast local active storage with encrypted, incremental workspace snapshots in
   durable object storage.

The benchmark must include:

- attach or restore latency;
- filesystem and `fsync` performance;
- inotify/file-watcher behavior;
- maximum disks and active workspaces per host;
- snapshot and recovery time;
- cost at expected workspace counts;
- host loss during a write; and
- movement between availability zones.

Git alone is not workspace persistence. Recovery must include uncommitted and
untracked files, worktrees, session state, and active branch identity.

Azure managed disks can be detached without deleting their data and reattached
to another VM:
[Azure managed disk overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview).

Exit criterion: host replacement preserves committed, uncommitted, and
untracked workspace state and restores it without allowing two writers.

## Phase 6: extract a lightweight workspace gateway

Keep the existing browser editor first. Create a dedicated headless server
entry in `packages/ide` using the runtime modules that the embedded CoDev client
actually needs.

The implementation sequence is:

1. Instrument the runtime RPC methods used by embedded CoDev sessions.
2. Capture those methods in a versioned compatibility manifest.
3. Add end-to-end protocol tests against the current `orca serve` backend.
4. Create a dedicated server composition root, separate from Electron's
   `src/main/index.ts`.
5. Put filesystem, process, secret, storage, and browser capabilities behind
   explicit interfaces.
6. Reuse Node-compatible runtime modules for files, Git, PTYs, and WebSockets.
7. Replace Electron-specific lifecycle, `BrowserWindow`, menu, native theme,
   and desktop session dependencies.
8. Package the gateway as a normal Node.js 24 service.
9. Run it inside the workspace Firecracker VM.
10. Roll it out behind a per-workspace feature flag.

The first gateway should support:

- authenticated pairing and WebSocket transport;
- file read/write/watch/search;
- Git and worktree operations;
- PTY creation, resize, input, and output replay;
- agent launch, resume, and status;
- workspace ports; and
- crash recovery and session metadata.

Browser automation or emulation that truly requires Chromium should be an
optional service started only when requested. It must not be part of editor or
terminal readiness.

Electron's documented process model explains why a dedicated hosted server is
preferable to launching the full desktop composition root for every workspace:
[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

Exit criterion: the existing browser client passes the compatibility suite
against the gateway without starting Electron, Chromium, AppImage, or Xvfb.

## Phase 7: converge onto one isolated runtime

After the gateway prototype proves its filesystem, PTY, networking, memory, and
agent behavior, run the gateway, terminal processes, Git, and agents inside the
same Firecracker workspace VM.

Migration requirements:

- quiesce old and new writers before switching;
- copy committed, uncommitted, and untracked files;
- preserve worktrees and branch identity;
- atomically update the workspace runtime generation;
- retain a recovery path for writes made after migration; and
- prove process crash, microVM crash, and host-loss recovery.

The Vercel control plane remains separate. It owns authentication,
authorization, membership, scheduling, metadata, and collaboration APIs. The
Azure runtime owns workspace files and processes. The existing parent/iframe
bridge continues to proxy control-plane features without exposing provider or
GitHub credentials to the browser.

Exit criterion: editor, terminal, interactive agents, backend-driven work,
publication, and resume behavior all operate on one authoritative workspace
filesystem.

## Phase 8: remove obsolete code and infrastructure

After the gateway and migration gates pass, remove:

- the server-side Electron AppImage;
- Xvfb and its systemd dependency;
- desktop application initialization during hosted server startup;
- per-session CLI self-install work;
- the bundled web client from the server artifact, since Vercel serves it;
- the old full `/orca` dashboard prewarm path;
- repeated open-route polling and stale-session recovery paths superseded by
  the durable state machine;
- post-build branding rewrites after equivalent source changes ship; and
- parent-page DOM mutation workarounds after the behavior lives in owned IDE
  source.

Audit [`apps/web/components/workspace/orca-project-tree.ts`](../apps/web/components/workspace/orca-project-tree.ts)
specifically. `packages/ide/CODEV-INTEGRATION.md` says this workaround should be
deleted, but the implementation still observes and modifies the iframe DOM.
Remove it only after the source-owned sidebar behavior is verified.

Do not remove Firecracker isolation, workspace authorization, quotas, fresh
pairing authorization, per-member attribution, or recovery fencing in the name
of startup speed.

## Perceived-performance design

The static shell should become useful immediately, not merely decorative.
Within one second of navigation it should show the real workspace chrome and
control-plane-backed information that does not require the runtime:

- branch and pull-request state;
- team presence and chat;
- workspace activity;
- agent/session history; and
- the last captured repository tree when available, clearly labeled if stale.

Only controls that need live compute should be temporarily unavailable. A
small readiness indicator should show truthful phases such as:

- Waking compute
- Restoring workspace
- Preparing repository
- Starting tools
- Ready

Do not show invented percentages. Keep the page layout stable, preserve focus,
use `aria-busy` and live-region announcements appropriately, support reduced
motion, and avoid blocking the whole interface behind a modal spinner.

Additional browser work:

- cache versioned IDE assets with immutable cache headers;
- prefetch the small shell entry from the dashboard;
- lazy-load PDF, emulator, settings, browser automation, and language workers;
- run a bundle analysis before deleting or regrouping chunks; and
- establish a first-load JavaScript and main-thread execution budget.

## Performance acceptance targets

Final service-level objectives should be confirmed after Phase 0, but the
initial targets are:

| Scenario                                 | Target                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| Static shell visible                     | p95 under 1 second                                              |
| Existing running workspace usable        | p95 under 1.5 seconds                                           |
| New session on a warm host               | p95 under 3–5 seconds                                           |
| Repository ownership work on normal open | No recursive scan                                               |
| Host replacement                         | No loss of committed, uncommitted, or untracked state           |
| Concurrent opens of one workspace        | Exactly one start operation                                     |
| Pool capacity available                  | No Azure VM creation on the click path                          |
| Cold pool miss                           | Useful UI under 1 second; compute readiness measured separately |

Performance verification must include large repositories, private
repositories, concurrent members, capacity exhaustion, host replacement,
credential revocation, permission revocation, and failed runtime recovery.

## Recommended implementation order

1. End-to-end measurements and dashboards.
2. Lightweight wake endpoint and durable start operation.
3. Remove recursive ownership and credential work from open.
4. Prepare repositories before navigation and preserve them outside the OS
   disk.
5. Build and deploy the preconfigured Azure image.
6. Keep one prepared host warm and introduce scheduling records.
7. Expand to a multi-host pool.
8. Prototype and roll out the headless workspace gateway.
9. Converge the gateway and all execution into the workspace Firecracker VM.
10. Remove Electron, Xvfb, obsolete polling, and integration workarounds.

Phases 2 and 3 can proceed in parallel after the baseline is available. The
gateway work should not block the earlier improvements, and the old backend
should remain available as a per-workspace rollback until parity, recovery, and
security tests pass.

## Non-goals

- Do not create one Azure VM per user.
- Do not rewrite the editor UI before testing a headless backend extraction.
- Do not claim that a browser-only IDE removes the need for compute; terminals,
  Git, agents, and file persistence still require a runtime.
- Do not trade workspace isolation or credential safety for a faster spinner.
- Do not use shallow clones globally without proving worktree and agent
  compatibility.
- Do not make unvalidated Azure hibernation support part of the critical plan.
