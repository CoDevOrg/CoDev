# CoDev backend-to-frontend integration contract

This document is the implementation guide for a new workspace frontend. The
hosted control plane, authenticated workspace APIs, realtime collaboration
services, durable agent runtime, Firecracker orchestration, persistence,
authorization, and secret management are available for the client to consume.

The frontend is intentionally technology-agnostic. It may use any editor,
terminal emulator, component system, or state-management library as long as it
honors the contracts and permission boundaries below.

## System boundary

```text
Frontend
  -> authenticated Next.js workspace APIs on Vercel
    -> PostgreSQL / Redis / OpenFGA / provider services
    -> Rust orchestrator on AWS
      -> isolated Firecracker microVM
        -> codev-guestd and /workspace
```

The browser must never receive provider credentials, GitHub installation
tokens, AWS credentials, database credentials, encryption keys, or orchestrator
credentials. Those remain in the Vercel control plane. The Firecracker guest
also receives no provider or GitHub credentials.

## Authentication and authorization

All workspace endpoints use the application's existing authenticated session.
For a same-origin frontend, use `fetch` with normal cookie credentials. A `401`
means the user is not authenticated; `403` means the authenticated user lacks
the required workspace permission.

| Role     | View | Edit | Terminal   | Run agents | Review/comment | Merge/publish | Manage access                                         |
| -------- | ---- | ---- | ---------- | ---------- | -------------- | ------------- | ----------------------------------------------------- |
| Owner    | Yes  | Yes  | Read/write | Yes        | Yes            | Yes           | Yes                                                   |
| Co-Steer | Yes  | Yes  | Read/write | Yes        | Yes            | Yes           | Invite; elevated role changes remain owner-controlled |
| Reviewer | Yes  | No   | Read-only  | No         | Yes            | No            | No                                                    |
| Viewer   | Yes  | No   | No         | No         | No             | No            | No                                                    |

OpenFGA is the authorization authority when configured. PostgreSQL membership
records are retained for workspace metadata and compatibility. Frontend code
must treat API denials as authoritative instead of duplicating permission logic.

## Canonical contracts

Shared Zod schemas and TypeScript types live in:

- `packages/contracts/src/domain.ts` — workspaces, members, agents, worktrees,
  claims, coordination messages, conflicts, publications, and pull requests
- `packages/contracts/src/collaboration.ts` — collaboration WebSocket messages
- `packages/contracts/src/terminal.ts` — terminal dimensions and output chunks
- `packages/contracts/src/events.ts` — durable workspace and agent events
- `packages/shared-types` — shared provider and event types

The new frontend should import these workspace packages where possible rather
than recreating response types manually.

## Workspace lifecycle APIs

| Method   | Endpoint                                 | Permission           | Frontend responsibility                                                                                                |
| -------- | ---------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/workspaces`                        | Signed-in user       | Create an empty workspace with `{}` or a repository workspace with `{ installationId, repositoryId }`.                 |
| `GET`    | `/api/workspaces/:workspaceId/sandbox`   | View                 | Read runtime and live sandbox state.                                                                                   |
| `POST`   | `/api/workspaces/:workspaceId/sandbox`   | Co-Steer or Reviewer | Start or resume the runtime. Handle `202` by polling; `201` means provisioned; an already-ready runtime returns `200`. |
| `POST`   | `/api/workspaces/:workspaceId/heartbeat` | Workspace member     | Record activity so an active workspace is not treated as idle.                                                         |
| `POST`   | `/api/workspaces/:workspaceId/sync`      | Owner                | Synchronize a stopped workspace with its repository snapshot.                                                          |
| `DELETE` | `/api/workspaces/:workspaceId`           | Owner                | Permanently delete the workspace and associated runtime state.                                                         |

Runtime states are `pending`, `provisioning`, `ready`, `hibernated`, `stopping`,
`stopped`, and `failed`. A new frontend should render all states and retry
runtime startup only for retryable failures or explicit user actions.

## Files, search, and Git APIs

| Method | Endpoint                                                           | Input                                   | Result or use                                                                  |
| ------ | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------ |
| `GET`  | `/api/workspaces/:workspaceId/sandbox/files`                       | Optional `?query=` up to 200 characters | `{ files }` or `{ matches }`; works from a hibernated snapshot when available. |
| `POST` | `/api/workspaces/:workspaceId/sandbox/files`                       | `{ path }`                              | `{ file: { path, contents, revision, ... } }`; works while hibernated.         |
| `PUT`  | `/api/workspaces/:workspaceId/sandbox/files`                       | `{ path, contents, expectedRevision }`  | Revision-checked save; requires edit permission and a ready runtime.           |
| `GET`  | `/api/workspaces/:workspaceId/sandbox/git?operation=status`        | None                                    | `{ output }` with porcelain/status text.                                       |
| `GET`  | `/api/workspaces/:workspaceId/sandbox/git?operation=diff`          | None                                    | `{ output }` with the integration diff.                                        |
| `GET`  | `/api/workspaces/:workspaceId/sandbox/git?operation=show&path=...` | Relative path                           | `{ contents }` from Git HEAD.                                                  |
| `GET`  | `/api/workspaces/:workspaceId/sandbox/branches`                    | None                                    | `{ branches, currentBranch }`, combining GitHub and sandbox branches.          |
| `POST` | `/api/workspaces/:workspaceId/sandbox/checkout`                    | `{ branch }`                            | `{ branch, headSha }`; requires edit permission.                               |
| `POST` | `/api/workspaces/:workspaceId/sandbox/exec`                        | `{ command: string[], workingDir? }`    | Bounded command result for authorized terminal writers.                        |
| `GET`  | `/api/workspaces/:workspaceId/preview/...path`                     | URL path                                | Serves a safe preview asset from the runtime or hibernated snapshot.           |

Save conflicts are expected behavior: keep each file's latest `revision` and
send it back as `expectedRevision`. On a conflict, reload the server version and
offer the user an explicit merge or retry flow. File bodies are limited to 2
MiB and paths must be relative to the workspace.

## Terminal APIs

The preferred transport is the WebSocket upgrade at:

`/api/workspaces/:workspaceId/sandbox/terminal/stream`

The server authenticates the upgrade, creates a PTY, sequences output, applies
bounded buffering/backpressure, accepts input and resize messages, and closes
the PTY on disconnect. Reviewers may receive read-only terminal access; input
and resize require terminal-write permission.

A request/response fallback is available at
`/api/workspaces/:workspaceId/sandbox/terminal`:

- `POST { action: "start", rows, columns }` -> `{ sessionId }`
- `POST { action: "input", sessionId, data }` -> `204`
- `POST { action: "resize", sessionId, rows, columns }` -> `204`
- `POST { action: "poll", sessionId, after }` -> `{ result }`
- `DELETE ?sessionId=...` -> `204`

Poll results contain ordered `{ sequence, data }` chunks, `nextSequence`,
`exited`, and `exitCode`. The frontend must acknowledge progress by advancing
`after`, preserve terminal order, and always close sessions it starts.

## Realtime collaboration

Two server implementations are retained:

1. `GET /api/workspaces/:workspaceId/collaboration` upgrades to CoDev's native
   Yjs WebSocket protocol.
2. `GET /api/workspaces/:workspaceId/collaboration/hocuspocus-token` returns a
   short-lived token for the standalone Hocuspocus service configured by
   `NEXT_PUBLIC_HOCUSPOCUS_URL`.

The native protocol is defined by `collaborationClientMessageSchema` and
`collaborationServerMessageSchema`. The required client flow is:

1. Open the authenticated WebSocket and send `join`, optionally with a
   `worktreeId` and previous Redis `resumeFrom` stream ID.
2. Send `subscribe` for a relative file path, optionally with the local Yjs
   state vector.
3. Apply incoming `sync` and `update` messages to the local Yjs document.
4. Send local document updates as Base64 Yjs `update` messages.
5. Send and apply Yjs `awareness` updates for collaborator presence.
6. Send `heartbeat` messages at the interval provided by `welcome`.
7. Handle `presence`, `reconciled`, `conflict`, and typed `error` messages.
8. On reconnect, join with the last stream ID and resubscribe using current
   state vectors.

Durable Yjs snapshots, state vectors, filesystem revisions, reconciliation
metadata, and conflicts are stored in PostgreSQL. Redis distributes realtime
events and coordinates document locks across server instances.

Resolve a reported conflict with:

`POST /api/workspaces/:workspaceId/collaboration/conflicts/resolve`

The body is `conflictResolutionInputSchema`: `path`, optional `worktreeId`,
`strategy` (`collaboration`, `filesystem`, or `merged`), both expected revision
tokens, and `mergedContents` only for the merged strategy.

## Agent session APIs

| Method   | Endpoint                                                   | Purpose                                                                                |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`    | `/api/workspaces/:workspaceId/agents`                      | List durable sessions with worktree, turns, events, claims, and coordination messages. |
| `POST`   | `/api/workspaces/:workspaceId/agents`                      | Start a session with `{ name, prompt, model?, provider?, attachments?, issue? }`.      |
| `POST`   | `/api/workspaces/:workspaceId/agents/:sessionId/turns`     | Queue `{ prompt, model?, attachments? }` as a follow-up.                               |
| `POST`   | `/api/workspaces/:workspaceId/agents/:sessionId/branch`    | Create a new isolated session from `{ fromTurnId, name?, prompt? }`.                   |
| `POST`   | `/api/workspaces/:workspaceId/agents/:sessionId/interrupt` | Interrupt queued or running work.                                                      |
| `DELETE` | `/api/workspaces/:workspaceId/agents/:sessionId`           | Delete a session and its worktree.                                                     |
| `POST`   | `/api/workspaces/:workspaceId/agents/stream`               | Stream an agent turn as server-sent events for a direct conversational surface.        |
| `GET`    | `/api/workspaces/:workspaceId/events`                      | Read canonical durable workspace events.                                               |

The backend supports OpenAI/Codex, Anthropic/Claude, Cursor, Amazon Bedrock,
Azure Foundry, and configured custom providers. The authoritative provider
options and model defaults live in `packages/contracts/src/providers.ts` and
`apps/web/lib/ai-model.ts`.

Agent attachments are validated by `apps/web/lib/agent-attachments.ts`. The
frontend should enforce those limits before upload and still handle server-side
validation errors. Agent quotas and concurrent-turn limits are enforced by the
backend and may return `429` with `Retry-After`.

## Agent coordination APIs

Each agent worktree participates in a workspace-wide path-claim namespace.
Agents are required to own a current claim before writing.

| Method   | Endpoint                                                             | Purpose                                                                                                   |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/workspaces/:workspaceId/agents/:sessionId/claims`              | List claims visible to the session.                                                                       |
| `POST`   | `/api/workspaces/:workspaceId/agents/:sessionId/claims`              | Create `createPathClaimSchema`: path or `directory/**`, intent, revision, TTL, and optional contest flag. |
| `DELETE` | `/api/workspaces/:workspaceId/agents/:sessionId/claims/:claimId`     | Release an owned active claim.                                                                            |
| `GET`    | `/api/workspaces/:workspaceId/agents/:sessionId/messages`            | List typed coordination messages.                                                                         |
| `POST`   | `/api/workspaces/:workspaceId/agents/:sessionId/messages`            | Send a claim request/response, handoff, or note using `coordinationMessageInputSchema`.                   |
| `PATCH`  | `/api/workspaces/:workspaceId/agents/:sessionId/messages/:messageId` | Mark a message `delivered` or `resolved`.                                                                 |

A replacement UI should expose active and contested claims, their path scopes,
owners, intent, expiry, and negotiation messages. Contested claims block safe
merge operations.

## Review, comments, and integration APIs

| Method | Endpoint                                                 | Permission | Purpose                                                                                     |
| ------ | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `POST` | `/api/workspaces/:workspaceId/agents/:sessionId/review`  | Reviewer   | Freeze/checkpoint the worktree and return its base SHA, head SHA, unified diff, and digest. |
| `POST` | `/api/workspaces/:workspaceId/comments`                  | Reviewer   | Add `{ body, filePath?, lineNumber?, sessionId? }` to the durable review activity.          |
| `POST` | `/api/workspaces/:workspaceId/agents/:sessionId/rebase`  | Co-Steer   | Rebase the agent worktree onto integration.                                                 |
| `POST` | `/api/workspaces/:workspaceId/agents/:sessionId/merge`   | Co-Steer   | Merge a reviewed worktree into integration after SHA, claim, and conflict checks.           |
| `POST` | `/api/workspaces/:workspaceId/agents/:sessionId/discard` | Co-Steer   | Discard the physical worktree and release its claims.                                       |

The frontend should never infer that a cached diff is mergeable. Refresh the
review before a decision and display backend conflict/rebase errors verbatim.

## Sharing and membership APIs

| Method   | Endpoint                                         | Purpose                                                                                                                 |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/workspaces/:workspaceId/invites`           | Create an invite for `invitee?` at `co_steer`, `reviewer`, or `viewer`; omitting the invitee creates a link invitation. |
| `DELETE` | `/api/workspaces/:workspaceId/invites/:inviteId` | Revoke an invitation.                                                                                                   |
| `PATCH`  | `/api/workspaces/:workspaceId/members/:userId`   | Change a member's access role.                                                                                          |

Invitation acceptance remains at `/invites/:token` and is outside the removed
workspace frontend.

## Credentials and environment

`GET`, `PUT`, and `DELETE /api/workspaces/:workspaceId/credentials` manage
workspace-level provider credentials. The backend accepts API keys, AWS Bedrock
role ARNs, and Azure endpoint credentials according to the route schema. It
returns only safe status metadata, never plaintext secrets.

Personal and organization credential/environment settings remain implemented.
Do not add secrets to client state, browser storage, logs, URLs, or
`NEXT_PUBLIC_*` variables. `NEXT_PUBLIC_HOCUSPOCUS_URL` and Clerk's publishable
key are intentionally public configuration; all other credential material is
server-only.

The existing `.env.local` files and deployment environment were not modified.
`.env.example` is the non-secret inventory for local setup. Important backend
groups include PostgreSQL/Supabase, Clerk, OpenFGA, Redis/Hocuspocus, GitHub App,
credential encryption/KMS, provider OAuth, AWS/Vercel OIDC, the orchestrator,
and lifecycle cron authentication.

## Publication and GitHub APIs

| Method | Endpoint                                     | Purpose                                                                                       |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/workspaces/:workspaceId/publications`  | List publication attempts and status.                                                         |
| `POST` | `/api/workspaces/:workspaceId/publications`  | Publish `{ branchName, expectedHeadSha }`; branch names must use the safe `codev/` namespace. |
| `POST` | `/api/workspaces/:workspaceId/pull-requests` | Open `{ branchName, title, body? }` through the GitHub App.                                   |
| `POST` | `/api/workspaces/:workspaceId/export`        | Publish and open a pull request in one operation.                                             |

Publishing requires all agent worktrees to be merged or discarded and uses
optimistic integration-head checks. GitHub tokens stay in the control plane.

## Additional backend surfaces

- `POST /api/workspaces/:workspaceId/agent-bug-reports` accepts bounded agent
  context and terminal errors for diagnostics.
- Health and readiness endpoints cover the website, database, realtime layer,
  orchestrator, and GitHub integration.
- Hibernation persists filesystem, process, PTY, worktree, and collaboration
  state; file reads and previews can use PostgreSQL snapshots while compute is
  asleep.
- VM minute quotas, prompt rate limits, attachment limits, command timeouts,
  and payload limits are server-enforced. The UI must handle `409`, `422`,
  `429`, `502`, and `503` responses without assuming data was lost.

## Replacement frontend checklist

The new workspace UI needs surfaces for:

- Runtime state, start/resume, heartbeat, failure, and hibernation
- File tree, repository search, file reads, revision-safe saves, and Git status
- Branch listing and checkout
- Code editing and original-versus-modified diffs
- Interactive terminal with reconnect, resize, sequencing, and cleanup
- Safe web preview routing
- Realtime document synchronization, presence, reconnect, and conflicts
- Durable agent session list, transcript, streaming events, follow-ups,
  attachments, branching, interruption, and deletion
- Parallel worktree status and agent/provider/model selection
- Claims and agent-to-agent coordination
- Review preparation, unified/file diffs, comments, rebase, merge, and discard
- Invitations, member roles, and capability-aware controls
- Publications and pull requests
- Quota/rate-limit/error states and accessibility feedback

No replacement UI should call the Rust orchestrator or Firecracker guest
directly. All browser traffic must pass through the authenticated workspace API
layer.

## Verification commands

After adding a replacement frontend, run:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm rust:check
```
