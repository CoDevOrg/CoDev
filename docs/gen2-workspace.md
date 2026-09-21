# Gen 2 workspace

**Status:** Current  
**Date:** 2026-09-20

Gen 2 is a new workspace, isolated from `lib/workspaces`. The product is:

> A workspace is a Firecracker cloud instance you can share, and Codex can do work on it.

## Shipped

- Create a gen 2 workspace (control-plane record + owner membership)
- Start / stop a Firecracker microVM through the existing Azure orchestrator
- Share a link; a signed-in person who opens it becomes a member
- Prompt Codex in multiple chats on the live instance (`codex exec --ephemeral --sandbox danger-full-access` with the chat transcript in the prompt; transcripts are stored in `gen2_chats` / `gen2_chat_messages`, including Codex replies after each turn)

## Out of scope

IDE, Gen 1 agent sessions, GitHub, hibernation, OpenFGA, worktrees, and the original `workspaces` table.

## Routes

- `/gen2` — list and create
- `/gen2/[id]` — instance, share, Codex prompt
- `/gen2/join/[token]` — accept a share link

Code lives under `apps/web/lib/gen2`, `apps/web/components/gen2`, and `apps/web/app/gen2`.
