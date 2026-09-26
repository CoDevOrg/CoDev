# Superset-powered workspace ownership contract

**Status:** Design; Phase 1 target, not a description of shipped behavior  
**Date:** 2026-09-24

## Decision

CoDev will evaluate a first-party fork of Superset's workspace runtime and
relevant interface components inside its hosted browser product. The first
integration target is the Gen 2 Firecracker workspace, which already gives the
editor, terminal, Git view, and Codex one filesystem. The existing workspace
implementations remain available while the new path is proven.

One CoDev workspace is one shared page, one Firecracker VM, and one project
repository. It can contain several branch contexts backed by Git worktrees.
Parallel, independent agent tasks use separate worktrees in that VM and remain
visible together on the same page. **Branches** is the user-facing term; a
person does not need to navigate to another CoDev workspace to see an agent.
Multiple agents may use one worktree only when the agent coordination policy
allows it; independent concurrent writers get separate worktrees.

The first release focuses on files, CodeMirror editing, live coediting,
terminals, Git/worktrees and diffs, agent sessions, and preview. Superset's
tasks, automations, wider integrations, and remote/mobile surfaces are later
scope. The full Electron application is not embedded in the browser.

## Ownership

### CoDev control plane and collaboration

CoDev is authoritative for:

- Sign-in, identity, invites, workspace membership, roles, and authorization.
- Workspace records, branch and agent-to-worktree mappings, audit events, and
  durable product history in CoDev persistence.
- Member and organization provider connections, credential encryption, renewal
  and writeback, GitHub access, and server-side publication.
- Quota checks, metering, billing attribution, and limits on agents, terminals,
  compute, and other billable operations.
- Azure Firecracker provisioning, resource isolation, hibernation, restoration,
  and cleanup through the CoDev orchestrator.
- Yjs document state, presence, live cursors, and collaborative conflict
  resolution. The document key includes CoDev workspace, worktree, and path.
- The authenticated browser gateway and the CodeMirror integration.

### Superset-derived guest runtime

The Superset-derived host service, running inside the CoDev workspace VM, is
authoritative for interactive operations on that VM's repository:

- File access and filesystem change observation.
- Git worktree creation, selection, status, diffs, and local Git operations.
- PTYs, terminal input/output, and agent process launch, monitoring,
  interruption, and recovery.
- Runtime events needed to keep the CoDev workspace view in sync.
- Local preview processes and ports when preview enters the first release.

Superset's local database may hold host process and session state, but it is
not the authority for CoDev users, permissions, credentials, quotas, or
workspace lifecycle. CoDev must persist the identifiers needed to reconnect
to that runtime state, and restoration must reconcile both sides.

Superset-derived browser components may provide workspace panels and
interactions. CoDev supplies the signed-in shell, role-aware actions, Yjs
binding for CodeMirror, and browser replacements for Electron-only behavior.

## Boundary rules

1. **One filesystem and one worktree writer.** The VM's repository and its
   worktrees hold saved file contents. The Superset-derived host service owns
   interactive Git/worktree mutations. Existing `codev-guestd` worktree
   endpoints must delegate to that owner or be removed from this path before
   both can operate. CoDev does not create a second agent filesystem.
2. **CoDev authorizes every operation.** Browser HTTP and WebSocket requests
   enter through CoDev-authenticated endpoints. The gateway checks the
   member's current capability and applicable quota before forwarding a
   read, write, terminal, agent, Git, or preview operation. The browser never
   receives a host-service administrative secret or direct privileged access.
   Revocation must also close or downgrade active streams and sessions.
3. **Credentials belong to the requesting member.** CoDev selects the
   provider connection for each agent launch. Any auth material needed by a
   CLI agent is placed only in that process's private guest profile for the
   required lifetime, renewed and returned to CoDev as needed, then removed.
   It is not installed as a host-wide default, inherited by unrelated
   terminals or agents, or readable by another member's shell. GitHub
   publication tokens remain in the Vercel control plane under the existing
   publication boundary.
4. **Live edits and external writes reconcile.** Yjs owns the live shared
   buffer while people edit. Revision-checked persistence writes it to the
   selected worktree. Agent or terminal writes to that same path are observed
   and reconciled with the live document; neither side silently overwrites
   the other. The UI exposes a conflict when automatic reconciliation cannot
   preserve both changes.
5. **Lifecycle is CoDev's decision.** A Superset agent or PTY cannot make a
   workspace outlive CoDev policy. Hibernation and restoration preserve or
   explicitly recover worktrees, host state, process/session status, and
   CoDev's durable mappings. Cleanup is idempotent and respects active work.
6. **The fork is first-party code.** Production workspace operations do not
   require a Superset cloud account or a call to Superset's hosted control
   plane. Imported source is pinned to a known upstream revision and CoDev
   changes are tracked so upgrades can be reviewed.

## Request path

```text
CoDev browser workspace (CodeMirror + Yjs + adapted Superset panels)
  -> CoDev authenticated API / WebSocket gateway on Vercel
    -> membership, capability, quota, credential, and audit services
    -> CoDev Azure orchestrator
      -> isolated Firecracker VM
        -> Superset-derived host service
          -> one repository, branch worktrees, PTYs, and agent processes
```

The host service needs a CoDev-specific run mode. Superset's current cloud
`sandbox` mode fixes a sandbox to one project and one workspace and blocks
creation of further workspaces; using it unchanged cannot meet the
multiple-worktree requirement. The CoDev mode must not inherit Superset's
host-wide managed provider environment for multi-member agent sessions.

## Phase 1 proof and exit criteria

The first implementation phase is an internal, flag-gated prototype. It is
ready for a replacement decision only when all of these work in one VM:

1. Two members can open the same CoDev workspace and live-edit a file with
   cursors in one selected worktree.
2. Two agents can run concurrently in separate worktrees; both sessions,
   branches, events, files, and diffs are visible from the same page.
3. A member can inspect changes and use a terminal in the selected worktree
   without seeing another member's provider material.
4. A role without write or agent-launch capability cannot invoke those
   operations through HTTP or WebSocket, even by bypassing the UI.
5. Quota and per-member credential checks apply to every launch, and agent
   activity is attributed to its requesting member.
6. VM hibernation/restoration or host-service restart leaves worktrees,
   CoDev mappings, and agent history consistent, with an explicit recovery
   state for any process that cannot resume.

The existing Orca and Gen 2 user paths are not removed during this phase.
Passing the prototype gates a separate rollout and migration decision.

## Implementation questions to resolve before the prototype

- Which `codev-guestd` file and worktree handlers become adapters to the
  host service, and which are retired on the new path?
- How will a long-running CLI agent receive a private credential refresh and
  return any refreshed auth cache without exposing it to human terminals?
- How will Yjs reconcile an agent's external file write while the same file
  has unsaved collaborative edits?
- Which host database and process records must be persisted or reconstructed
  after Firecracker restore?

Related design and current contracts: [Superset adoption manifest](./SUPERSET_ADOPTION_MANIFEST.md),
[Gen 2 workspace](./gen2-workspace.md),
[backend/frontend integration](./BACKEND_FRONTEND_INTEGRATION.md),
[security boundary](./SECURITY.md), and
[branch workspaces](./branch-workspaces-plan.md).
