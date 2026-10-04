# Gen 2 workspace

CoDev's active workspace implementation.

A gen 2 workspace is a **shareable Firecracker cloud instance** that you and
Codex work on together — one filesystem, addressed by the chat and by the
workbench alike.

## Runtime boundary

The web workbench, terminal, Git operations, and agents all target the
workspace's Firecracker guest. Gen 2 workspace membership is checked before
the control plane calls the orchestrator. Historical Gen 1 data and database
migrations are preserved; its application code has been removed.

## Codex chats

Each workspace has many chats. Transcripts live in `gen2_chats` /
`gen2_chat_messages`. Each turn is a fresh `codex exec --ephemeral --sandbox
danger-full-access` with prior messages in the prompt, so a shareable machine
never keeps a personal Codex thread or auth home. Firecracker is the isolation
boundary.

A turn runs on the provider the member picks (`provider` on the start request, Codex by default). `agent-command.ts` chooses `codex exec --json` or `claude -p --output-format stream-json`, and `turn-reducer.ts` reads the provider back from the stream itself, so neither the browser nor the `gen2_agent_turns` row needs to remember it.

`turn-events.ts` reduces the `codex exec --json` NDJSON (`claude-turn-events.ts` does the same for Claude) into typed activity
items. Codex gives every item a stable `id` across
`item.started`/`item.updated`/`item.completed`, so re-reducing the accumulated
stream on each poll is idempotent: cards update in place instead of
duplicating, and React keys never churn.

`turns.ts` accumulates that stream **server-side**. This is not an
optimisation — `poll_codex_exec` in the guest discards every chunk at or below
the acknowledged sequence, so a turn cannot be re-read after the fact. Whoever
polls has to keep it. The poll route appends to `gen2_agent_turns` and writes
the assistant message when the process exits, which is why a reply survives a
closed tab and why the other members of a shared workspace can see the turn.

## Files, Git, and terminals

`workbench.ts` and `terminals.ts` wrap the orchestrator clients. A checkout with more than 5,000 files is listed from the cloned GitHub commit so the guest walk does not hide the tree. Both check
membership **before** touching `lib/runtime/orchestrator-*`, which performs no
authorization of its own — a route reaching those clients directly would be an
IDOR across every gen 2 workspace. Keeping the guard in this layer means a new
route cannot forget it.

Only some guest handlers wait for Codex to go idle (`write_file`, `/pty/exec`,
`start_terminal`); `read_file`, `git/*`, and terminal poll/input do not. The
ready-gate on each function follows that split, and
[`docs/gen2-workspace.md`](../../../../docs/gen2-workspace.md) has the table.

The terminal stream and shared-document sockets use the platform WebSocket adapter in `lib/platform/websocket.ts`; Cloudflare Workers use native WebSocket pairs, and Vercel keeps its upgrade helper.

## Layout

| Path                           | Role                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| `apps/web/lib/gen2`            | Domain: create, members, share, start/stop, Codex, files, Git, terminals |
| `apps/web/components/gen2`     | Chat column, activity cards, workbench, editor, terminal, Git            |
| `apps/web/app/gen2`            | Pages and CSS                                                            |
| `apps/web/app/api/gen2`        | HTTP                                                                     |
| `packages/db` `gen2_*` tables  | Persistence                                                              |
| `packages/contracts` `gen2.ts` | Request/response shapes                                                  |

The Azure orchestrator is reused (`provisionSandbox` / `destroySandbox`). Gen 2
uses its own `gen2_*` tables and does not access the original `workspaces` table.

`compute-quota.ts` bills each running Gen 2 VM interval to its current workspace
owner. The 1,000-minute allowance is shared across that owner's workspaces and
resets at the UTC month boundary. `compute-reconcile.ts` checks runtime state
without waking guests, closes hibernated intervals, and stops active guests at
the limit. The Cloudflare per-minute scheduled handler invokes the authenticated
route; startup checks the same live interval total before provisioning.
