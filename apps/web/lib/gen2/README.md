# Gen 2 workspace

A new CoDev workspace, built separately from `lib/workspaces`.

A gen 2 workspace is a **shareable Firecracker cloud instance** plus Codex chats that run on that machine.

## What this is not

No IDE iframe, Gen 1 agent sessions, worktrees, GitHub pin, hibernation, or OpenFGA. Those stay in gen 1 until they are rebuilt here on purpose.

## Codex chats

Each workspace has many chats. Transcripts live in `gen2_chats` / `gen2_chat_messages` (not Codex `exec resume`, not files on the VM, not the browser). After a turn finishes, the panel saves the Codex reply so it is still there on reload. The next turn is a fresh `codex exec --ephemeral --sandbox danger-full-access` with prior messages in the prompt, so a shareable machine never keeps a personal Codex thread or auth home. Firecracker is the isolation boundary; Codex's inner `workspace-write` sandbox cannot spawn a shell in the guest.

## Layout

| Path                                           | Role                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `apps/web/lib/gen2`                            | Domain: create, members, share, start/stop, Codex exec |
| `apps/web/components/gen2`                     | List, room, join, Codex prompt UI                      |
| `apps/web/app/gen2`                            | Pages                                                  |
| `apps/web/app/api/gen2`                        | HTTP                                                   |
| `packages/db` `gen2_workspaces` / `gen2_chats` | Persistence                                            |
| `packages/contracts` `gen2.ts`                 | Request/response shapes                                |

The Azure orchestrator is reused (`provisionSandbox` / `destroySandbox`). Gen 2 does not read or write the original `workspaces` table.
