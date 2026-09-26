# Superset adoption manifest

**Status:** Design; Phase 1 source map, not an implementation guarantee
**Date:** 2026-09-24

## Source pin

CoDev vendors Superset as first-party source in `vendor/superset`. The pinned
upstream revision, import commit, and snapshot verification are recorded in
[`vendor/superset/UPSTREAM.md`](../vendor/superset/UPSTREAM.md). At import,
the vendored subtree hash exactly matched the upstream tree. The current
directory also contains CoDev's upstream metadata and any later CoDev patches.
The root Git commit that imported the snapshot is
`1f6ff1055a84b2c41677b082dc612d33d6e92e09`.

Keep the snapshot available for review and upstream updates, but build only
the packages needed by CoDev. This map selects an integration slice; it does
not recommend importing the whole Superset application into the web app.

## Build and tooling boundary

- The root `pnpm-workspace.yaml` includes `apps/*` and `packages/*`; it does
  not include `vendor/superset`. Keep it that way during the prototype.
- Superset is a Bun monorepo with its own `bun.lock` and package scripts. Run
  Superset-specific checks from `vendor/superset`, not through root recursive
  pnpm commands.
- The root `.prettierignore` and `lint-staged` configuration currently have
  local changes excluding `vendor/superset`. Keep that exclusion so root
  formatting does not rewrite the imported snapshot. These changes are
  separate from the committed Markdown contract files.
- Build the host runtime as a separate Azure guest artifact. Do not import
  host-service, PTY, SQLite, or filesystem-watcher code into a Vercel request
  bundle or the browser bundle.
- The host runtime has native Linux dependencies, including `node-pty`,
  `better-sqlite3`, and `@parcel/watcher`. The guest build must use a compatible
  Linux/Node/Bun toolchain and verify those modules load in the Azure guest.
  Root developer tooling and the guest artifact are separate build targets.

## Phase 1 runtime source

### Required host-service core

Start from `packages/host-service`, especially:

- `src/serve.ts` and `src/app.ts` for the host process, HTTP/WebSocket
  listeners, provider adapters, events, filesystem, and runtime startup.
- `src/trpc/router/agents/` for terminal-agent launch and session controls.
- `src/trpc/router/terminal/` and `src/terminal/` for PTYs and terminal
  lifecycle.
- `src/trpc/router/filesystem/`, `src/trpc/router/git/`, and
  `src/trpc/router/workspaces/` for file, Git, and worktree operations.
- `src/events/` and `src/runtime/filesystem/` for file/Git change
  notification and watching.
- `src/db/` for host-local process/session records that need a CoDev restore
  policy.

The host-service package's direct runtime dependencies include these workspace
packages:

- `@superset/agent-setup` for CLI agent configuration and provider profiles.
- `@superset/pty-daemon` for detached PTY lifecycle.
- `@superset/workspace-fs` for filesystem watching and path matching.
- `@superset/shared`, `@superset/port-scanner`, and `@superset/chat` for
  runtime contracts and support code.
- `@superset/chat-runtime` for Superset Chat v3 sessions. The current host
  app mounts it; make it optional or remove it if Phase 1 uses only terminal
  agent sessions.
- `@superset/trpc` is currently referenced for Superset's cloud API router
  types. Its package includes a broad set of cloud integrations. Replace or
  split this boundary before treating it as a small runtime dependency.

This is a source dependency map, not yet a minimal package lockfile. The first
guest build must identify the transitive runtime closure and remove any
Superset cloud-only dependencies that CoDev does not use.

`@superset/i18n` and `@superset/host-client` are listed as host-service
development dependencies at this revision. Recheck the package metadata when
the isolated build is defined; do not promote development-only packages into
the guest runtime without a source-level need.

### Required CoDev adapters

The current standalone `serve.ts` assumes Superset authentication, API URL,
organization ID, host secret, Git credentials, and sandbox bootstrap. The
`createApp` path also constructs Superset API and pull-request services.
Implement a CoDev host mode that:

- Uses CoDev's authorized gateway as the only browser entry point.
- Replaces Superset session/cloud auth with host-to-gateway machine
  authentication; it does not reuse CoDev member cookies as host credentials.
- Resolves provider credentials for the requesting member and agent process,
  never from a shared host-wide default environment.
- Uses CoDev's GitHub credential and publication boundary rather than a
  Superset-hosted GitHub account.
- Supports multiple branch worktrees in one CoDev VM and persists the mapping
  from CoDev workspace/branch/agent IDs to Superset runtime IDs.
- Makes Superset cloud API integrations optional or replaces them with
  explicit CoDev adapters.

The host service's cloud `sandbox` mode is not the CoDev mode: it assumes one
project/workspace per sandbox and disables creation of more. Do not enable
that mode unchanged for the multi-worktree prototype.

## What Superset replaces in CoDev

The Gen 2 route is a separate workspace product today. Its current browser
page is `apps/web/app/gen2/[workspaceId]/page.tsx`; its CodeMirror workbench
and chat live under `apps/web/components/gen2/`. The matching REST APIs are
under `apps/web/app/api/gen2/workspaces/[workspaceId]/` and call CoDev's
Gen 2 libraries plus the orchestrator guest API. The guest implementation is
in `services/orchestrator/src/guest.rs`.

On a Superset-backed path, the ownership change is:

| Current CoDev path                                                                                                        | Superset-backed path                                                                                                                                           | CoDev responsibility that stays                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Gen 2 `agent` and `agent/poll` routes launch and poll fresh `codex exec` turns through `lib/gen2/agent.ts` and the guest. | Superset host-service launches and tracks terminal-agent sessions; CoDev's route adapter creates, streams, interrupts, and maps those sessions.                | Member credential selection, launch permission, quota reservation, metering, durable CoDev activity, and actor attribution.            |
| Gen 2 `files`, `git`, and `terminal` routes call guest handlers for file I/O, Git, and PTYs.                              | Those same authenticated CoDev routes call a private adapter to Superset host-service for the selected worktree.                                               | CoDev auth, per-operation role checks, workspace identity, and request limits.                                                         |
| Gen 2 `chat` routes and `chat-panel.tsx` show the CoDev-specific Codex conversation.                                      | Port Superset's agent/session presentation and selected `ChatV3Pane` or agent terminal UI into the CoDev page, backed by Superset sessions.                    | CoDev workspace membership and shared activity. Keep CoDev chat only if product explicitly chooses to retain it as a separate surface. |
| CoDev Gen 2 file tree and Git panel show one checkout.                                                                    | Adapt Superset's file, terminal, changes, and worktree panels; group internal agent worktrees under one CoDev workspace page.                                  | CoDev CodeMirror 6 and Yjs remain the shared live editor and presence system.                                                          |
| Gen 1 page embeds the Orca IDE and its runtime pairing/agent connections.                                                 | After the Gen 2 prototype passes, make the Superset-backed workspace the normal CoDev workspace route and remove the Orca surface through a planned migration. | CoDev sign-in, invites/roles, credential vault, quotas, workspace records, and Azure VM lifecycle.                                     |

The browser never calls the host service directly. The page calls existing or
new CoDev API routes; those routes authenticate the member and check role and
quota, then the orchestrator forwards the request to the private host service
inside that workspace VM. The UI is changed to Superset-derived React panels;
the backend calls are changed to the Superset host service. Both changes are
required before users are actually using Superset.

The first Superset-enabled Gen 2 page is a migration proving ground, not yet a
replacement for the normal Gen 1 workspace page. A later cutover must map the
normal CoDev workspace ID, member roles, repository state, lifecycle, and
existing user entry point onto the Superset-backed VM. Do not describe the
normal workspace product as replaced until that route and data migration are
complete.

## Browser workspace source map

The relevant renderer is under
`apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/`.
Treat it as a source of interaction patterns and candidate components, not a
browser-ready route. The route imports Electron APIs, desktop stores, local
host discovery, feature-flag services, and the Superset pane registry.

Candidate components to adapt selectively:

- `.../$workspaceId/hooks/usePaneRegistry/components/ChatV3Pane/` for agent
  transcript, prompt, and session presentation if the CoDev product adopts
  Superset Chat v3.
- `.../$workspaceId/hooks/usePaneRegistry/components/TerminalPane/` for
  terminal interactions and agent terminal presentation.
- `.../$workspaceId/hooks/usePaneRegistry/components/SubagentPane/` for
  subagent status and transcript presentation.
- `.../$workspaceId/hooks/usePaneRegistry/components/DiffPane/` and
  `.../$workspaceId/components/WorkspaceSidebar/` for changes, file
  navigation, and review interaction patterns.
- `.../$workspaceId/hooks/usePaneRegistry/components/FilePane/` for file
  navigation patterns only. Keep CoDev's existing CodeMirror 6 editor and
  bind it to CoDev Yjs; do not adopt the Superset CodeEditor as the editor
  authority.

The desktop route and its `WorkspaceProvider`/`WorkspaceTrpcProvider` are not
direct imports for `apps/web`. `@superset/workspace-client` imports the host
`AppRouter` type and declares the host-service package as a dependency; build
a browser-safe CoDev client facade that calls CoDev APIs instead of pulling
that host package into the web dependency graph.

Do not include in the first browser slice:

- The Electron main/preload bridge, native menus, Finder/external-editor
  actions, or Electron webContents browser pane.
- Superset's workspace/project creation flow, local-machine discovery, or
  Superset cloud auth and account settings.
- Pull-request panes that call Superset APIs directly. CoDev keeps GitHub
  publication and authorization in its existing control plane.
- Tasks, automations, mobile/remote surfaces, and other wider Superset
  product features deferred by the Phase 1 scope.

## Phase 1 integration sequence

1. Produce a guest build of the selected host-service dependency closure and
   start it beside the existing Gen 2 guest services.
2. Route one authorized CoDev file, Git status/diff, and terminal operation
   through a CoDev API adapter to the host service.
3. Run one Superset terminal agent through the same adapter, scoped to one
   selected worktree and the requesting member's credential profile.
4. Add a second worktree and a second concurrent agent; verify the CoDev page
   can list and inspect both without switching top-level workspaces.
5. Connect CodeMirror/Yjs to that worktree and reconcile a human edit with an
   external agent write.
6. Verify a host restart and Gen 2 snapshot/restore preserve files, worktrees,
   agent mappings, and recoverable session state.

This map is complete when the selected source set, browser adaptation list,
cloud-only seams, and isolated build boundary are understood. Passing the
guest/runtime proof remains a later gate; this manifest does not claim those
services already work together.
