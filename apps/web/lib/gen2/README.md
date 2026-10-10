# Gen 2 workspace

CoDev's active workspace implementation.

A Gen 2 workspace is a shareable cloud instance that you and Codex work on
together. New workspaces use Azure ARM for both paid/admin and eligible free
owners, with their existing entitlement limits. The shared Firecracker host is
retired. ARM workspaces use the domain clients through a provider-aware,
generation-bound signed tunnel adapter.

Cloudflare collaboration sockets own their Redis clients, stream-reader rooms,
and fan-out identities through `collaboration-context.ts`. Socket callbacks
restore that context and use message-scoped database pools; HTTP response cleanup
must not close resources needed by later socket messages.

## Runtime boundary

`arm-workflow-continuation.ts` claims and activates bounded lifecycle instances
on Workers Free; `arm-workflow-database.ts` owns their short-lived Hyperdrive
connections. Completed phases resume from stored runtime resources, while
unfinished phases carry request checkpoints so retries do not repeat mutations.

The web workbench, terminal, Git operations, and agents all target the
workspace's selected guest. Gen 2 workspace membership is checked before
the control plane calls the orchestrator. Historical Gen 1 data and database
migrations are preserved; its application code has been removed.

## Workspace home

`home-snapshot.ts` reads a member's workspaces and compute usage together for
the home page and its `GET /api/gen2/home` poll. It reads the database only, so
polling never wakes a guest or counts as activity. The poll stays off
`/api/gen2/workspaces`, whose per-IP edge rate limit also guards creation.

## Codex chats

Each workspace has many chats. Transcripts live in `gen2_chats` /
`gen2_chat_messages`. Each turn is a fresh `codex exec --ephemeral --sandbox
danger-full-access` with prior messages in the prompt, so a shareable machine
never keeps a personal Codex thread or auth home. The workspace VM is the isolation
boundary.

A turn runs on the provider the member picks (`provider` on the start request, Codex by default). `agent-command.ts` chooses `codex exec --json`, `claude -p --output-format stream-json`, or `cursor-agent --print --output-format stream-json`, and `turn-reducer.ts` parses output using the provider stored on `gen2_agent_turns`.

`workspace-agent-instructions.ts` owns the provider-neutral workspace contract
prepended to every agent turn. Provider command builders own CLI flags only and
must use that shared formatter so current and future agents receive the same
durability, protected-path, credential, and user-facing environment guidance.

`turn-events.ts` reduces the `codex exec --json` NDJSON (`claude-turn-events.ts` does the same for Claude) into typed activity
items. Codex gives every item a stable `id` across
`item.started`/`item.updated`/`item.completed`, so re-reducing the accumulated
stream on each poll is idempotent: cards update in place instead of
duplicating, and React keys never churn.

`turns.ts` and `turn-chunks.ts` accumulate that stream **server-side**. This is not an
optimisation — `poll_codex_exec` in the guest discards every chunk at or below
the acknowledged sequence, so a turn cannot be re-read after the fact. Whoever
polls has to keep it. The poll route appends to `gen2_agent_turns` and writes
the assistant message when the process exits, which is why a reply survives a
closed tab and why the other members of a shared workspace can see the turn.

## Imported sessions

Editors can import a local Codex rollout or Claude Code transcript as a chat
(`session-import.ts`). An upload is redacted first (`session-import-redact.ts`):
only the redacted file is stored, gzipped and encrypted, in
`gen2_session_imports`, because every member sees the chat and native resume
will hand the file to whoever continues it. `session-import-parse.ts` then
parses it with the provider's reader (`session-import-codex.ts`,
`session-import-claude.ts`) into messages with the same activity cards live
turns use; Claude tool blocks share `claude-tool-items.ts` with the live
reducer. The upload is a draft only its importer can see until they confirm
the preview. Imported chats continue like any other chat today; native
resume is not wired yet.

## Agent coordination

Coordination warns members and agents when active agents overlap
(docs/SUPERSET_AGENT_COORDINATION.md). `agent-coordination-feature.ts` owns
the per-workspace rollout flag. `agent-overlaps.ts` asks the guest host to
compare the worktrees of active Superset runs and never wakes a machine.
`duplicate-task-check.ts` is the lexical, CoDev-only launch check used by
`startGen2AgentTurn`. `agent-coordination-hooks.ts` adds the `PostToolUse`
hook to native turn profiles; the guest supplies the turn's token. Change sets,
overlap detection, and agent notices belong to the guest host, not this
directory.

## Files, Git, and terminals

`workbench.ts` and `terminals.ts` wrap the orchestrator clients. A checkout with more than 5,000 files is listed from the cloned GitHub commit so the guest walk does not hide the tree. Both check
membership **before** touching `lib/runtime/orchestrator-*`, which performs no
authorization of its own — a route reaching those clients directly would be an
IDOR across every gen 2 workspace. Keeping the guard in this layer means a new
route cannot forget it. Terminal operations and socket membership rechecks require
an editor or owner role; viewers cannot access the shared shell. Terminal access
is never cached; socket input, resize, and output delivery recheck current membership. `terminal-access.ts` reads that membership with the guest route in one query, so each keystroke batch and output poll costs one database round trip. Collaboration
updates recheck the current member role rather than trusting handshake permissions.
Broadcasts and replay verify live membership before delivering workspace data;
removed members are disconnected. Native file writes/uploads and agent starts
also require an editor or owner role.

Only some guest handlers wait for Codex to go idle (`write_file`, `/pty/exec`,
`start_terminal`); `read_file`, `git/*`, and terminal poll/input do not. The
ready-gate on each function follows that split, and
[`docs/gen2-workspace.md`](../../../../docs/gen2-workspace.md) has the table.

The terminal stream and shared-document sockets use the platform WebSocket adapter in `lib/platform/websocket.ts`; Cloudflare Workers use native WebSocket pairs, and Vercel keeps its upgrade helper.

`remote-branches.ts` lists the repository's branches from GitHub with the
caller's own GitHub authorization, never the owner's, so a member who cannot see
the repository on GitHub learns no branch names. Public repositories are cloned
with every remote branch, so the top bar opens one as a worktree from
`origin/<branch>`; private repositories arrive as a one-commit snapshot without
a remote, so their other branches are listed but cannot be opened yet.

## Layout

| Path                           | Role                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `apps/web/lib/gen2`            | Domain: create, members, share, start/stop, Codex, files, Git, terminals     |
| `apps/web/components/gen2`     | Superset workspace shell: chat, activity cards, files, editor, terminal, Git |
| `apps/web/app/gen2`            | Pages and CSS                                                                |
| `apps/web/app/api/gen2`        | HTTP                                                                         |
| `packages/db` `gen2_*` tables  | Persistence                                                                  |
| `packages/contracts` `gen2.ts` | Request/response shapes                                                      |

The Azure orchestrator is reused (`provisionSandbox` / `destroySandbox`). Gen 2
uses its own `gen2_*` tables and does not access the original `workspaces` table.

`compute-quota.ts` retains owner-funded intervals across deletion and ownership
transfer, clipped to UTC months. Billing resolves current entitlements: paid
owners keep 1,000 minutes, admins remain unlimited, and eligible free ARM owners
receive 50 hours with one workspace or 35 shared hours with two. Used time never
resets when slots change. ARM allocated boot time counts; stopped-but-allocated
VMs remain billable until release. Power-state reads never wake guests.

Free rollout defaults off. `free-compute-claim.ts` serializes one-active reservations
with create/delete/transfer using owner locks. `compute-switch.ts` requires the
owner to name the workspace being stopped; callers poll stop completion before
retrying the target start. `owner-budget-report.ts` accepts authenticated complete
cost snapshots; the guard blocks free compute on missing/stale telemetry, an
operator hold, or a US$6.50 monthly total. The per-minute reconciler enforces quota,
budget, and idle release. See the [Phase 5 review](../../../../docs/arm-workspace-free-tier-phase-5.md).

## ARM bridge and background turns

`arm-workspace-initialize.ts` sends public repository sources or credential-free
private snapshots to a protected new-disk initializer before startup publishes
ready. Reopens never download or replace an initialized checkout.
`arm-workspace-turn-poll.ts` serializes browser and cron polls with a persisted
cursor from migration `0068`; only saved chunks are acknowledged to the guest.
`arm-workspace-turns-reconcile.ts` drains turns without recent browser polling.
Idle shutdown waits for both live agent activity to stop and pending transcripts
to finish saving. See the Phase 4 review for image and staging requirements.

The hourly `infra/azure/collect-arm-owner-costs.mjs` collector owns Azure billing
query/attribution and calls the authenticated budget ingestion boundary. The web
layer does not poll Azure Cost Management on member requests.

`arm-workflow-binding.ts` uses the native lifecycle binding on Cloudflare and
forwards Vercel dispatch/status calls to the canonical Worker using `CRON_SECRET`.
`arm-workflow-bridge.ts` validates service authentication and shared operation
parameters; its endpoint requires a native binding and cannot proxy recursively.

Cursor subscriptions resolve through the provider registry and use a private
file credential store under each turn profile. The ARM image must include the
pinned Linux ARM64 Cursor CLI before the workspace picker is deployed.

Cursor uses native guest exec unless `CODEV_SUPERSET_CURSOR_AGENTS_ENABLED` is
also on; then it runs as a Superset agent like Codex and Claude. Poll and cancel
route by the turn's session ID (a Superset run UUID or a guest session ID), so a
turn stays on the path that started it. Refreshed auth belongs to the turn’s
initiating member on both paths.

Guest turn polls use `withDatabaseOperation` for all routing, transaction, and
auth-refresh queries across the long guest wait. They must not rely on an HTTP
React cache that can be unavailable inside nested asynchronous work.

Agent starts validate the selected model against the initiating member’s live
provider catalog before either native or Superset execution. The composer keeps
catalogs and model preferences separate for each provider; Cursor chats must
reach the composer as Cursor. No model choices are bundled into the client.

Existing member role changes require the owner, including through add-member.
Removing a member clears the active shared invitation in the same transaction.
`workspace-invite-access.ts` locks and revalidates invitations before admission,
using the workspace row shared with removal; owner admission retains owner-lock ordering.

Viewer/editor share links admit multiple people until their original seven-day
expiry or revocation. Opening sharing reuses the active link and its access role.
`workspace-share-invite.ts` serializes creation and reuse; signed capabilities
are reconstructed from the stored random hash using `AUTH_SECRET`, preserving
existing opaque links. Ownership transfer is separate from group invitations.

## Models the workspace CLI cannot run yet

`agent-cli-fallback.ts` covers the gap between a provider shipping a model and
the image update that can run it. Claude Code reports `Claude Code X does not
support this model; version Y or newer is required`. When it does, the turn
saves no error. After its poll commits, `agent-cli-continuation.ts` records the
requirement in `agent_cli_model_requirements` against the promoted image. It
then re-runs the latest prompt on the closest same-family model with a note,
and links the turns through `continued_as_session_id` so the browser follows.
Later turns on that model start on the fallback directly. The CLI updater reads
`/api/gen2/agent-cli-requirements` (service secret) and ships a satisfying CLI
without its release delay. A newer promoted image retries the model. Codex
needs none of this: its catalog follows `CODEX_CATALOG_CLIENT_VERSION`.
