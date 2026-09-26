# Gen 2 workspace

**Status:** Current  
**Date:** 2026-09-26

Gen 2 is a new workspace, isolated from `lib/workspaces`. The product is:

> A workspace is a Firecracker cloud instance you can share, and you and Codex
> work on it together.

The thing Gen 1 could never offer: **one filesystem**. Gen 1's interactive IDE
session and its agent sandbox are separate filesystems (`AGENTS.md`, "Runtime
isolation"). In Gen 2 there is only the guest — Codex runs
`codex exec --cd .` in `/workspace`, and the editor, terminal, and Git panel
address that same `/workspace` through the orchestrator. The file you open is
the file the agent just edited.

## Shipped

- Create a gen 2 workspace (control-plane record + owner membership)
- A Firecracker microVM that comes up when someone opens the workspace --
  there is no start button, the request is idempotent, and concurrent opens
  are resolved by a compare-and-set so only one of them provisions
- Share a link; a signed-in person who opens it becomes a member
- Prompt Codex in multiple chats on the live instance, with the turn rendered
  as it happens: reasoning, commands and their exit codes, file changes, and
  the plan, parsed from the `codex exec --json` item stream
- Connect ChatGPT in the workspace itself, or fall back to a personal OpenAI
  API key; turns run on the asking member's own credential
- Create a workspace from a GitHub repository (public repositories are cloned
  by the host, private ones arrive as a bounded snapshot the control plane
  fetched, so no GitHub token enters the VM)
- Own up to two Gen 2 workspaces at a time; shared workspaces do not count
- Delete an owned workspace to remove its guest and saved disk snapshots and
  free an ownership slot
- Run up to six active sandboxes per host; idle guests hibernate after 15
  minutes and a quiet host deallocates after one minute
- Upload a local file onto the machine
- A workbench beside the chat — file tree with Git status, a CodeMirror 6
  editor with revision-checked saves, a shell, and a live Git status/diff

## No start button

Opening a workspace is the intent to use it, so `ensureGen2Instance` runs on
open and is safe for any member to call -- the person who follows a share link
should not have to wait for the owner to press something. The composer is
never disabled either: type into a cold workspace and the machine is brought
up as part of sending. The orchestrator hibernates an idle guest after 15
minutes, preserving its workspace disk while releasing its sandbox slot. A
host with no active sandboxes deallocates after one quiet minute. Opening the
workspace resumes it from the saved disk.

## Interface

Chat is the primary column. The workbench on the right collapses to an icon
rail and has three tabs: Files (tree + editor), Terminal, and Git. It is
modelled on an agent UI, not an IDE: the chat is where the work is directed,
and the workbench is how you watch and intervene.

## The guest serialises some calls behind a running turn

`services/orchestrator/src/guest.rs` takes a mutation lock and waits for Codex
to go idle in some handlers but not others. The UI pauses precisely the ones
that would otherwise block until the orchestrator's 70 s timeout turns them
into a 502:

| Guest handler                            | Blocks mid-turn | What the UI does                                  |
| ---------------------------------------- | --------------- | ------------------------------------------------- |
| `read_file`                              | no              | Opening a file keeps working.                     |
| `write_file`                             | yes             | Save is disabled while the agent runs.            |
| `/pty/exec`                              | yes             | Tree listing and search pause (both use exec).    |
| `start_terminal`                         | yes             | "Start terminal" is disabled; open ones are fine. |
| `git/status`, `git/diff`                 | no              | The Git tab stays live and polls every 4 s.       |
| terminal `input`/`resize`/`poll`/`close` | no              | An open shell streams through a turn.             |

Terminals also used to be closed outright whenever a turn began: Codex writes
its provider token into a private `CODEX_HOME` on the guest, and a root shell
in the same microVM could read it -- on a shared workspace that means one
member taking another's ChatGPT credential. Shells now drop to an
unprivileged `codev-shell` account (`guest.rs` `TerminalUser`, created by
`bootstrap-host.sh`) that cannot read it, so a terminal survives a turn. A
guest image without that account is detected at startup and falls back to the
old close-on-turn behaviour, so an un-rebuilt host is safe rather than
exposed.

When a turn ends, the tree, the Git panel, and any open buffer refresh. A
buffer with unsaved edits is never overwritten: it offers "Keep mine" or "Take
theirs" instead. Saves carry `expectedRevision`, so a stale write is a 409 with
the current revision rather than a silent clobber.

## Turn transcripts live on the server

The guest drops output as soon as a poll acknowledges it, so the transcript
only exists where the poller keeps it. `gen2_agent_turns` accumulates the
decoded stream per poll and writes the assistant message — with its activity
cards in `gen2_chat_messages.items` — when the process exits. Closing the tab
mid-turn no longer loses the reply, and the other members of a shared
workspace see the turn too.

Each turn is still a fresh `codex exec --ephemeral --sandbox
danger-full-access` with the prior messages in the prompt, so a shareable
machine never keeps a personal Codex thread or auth home.

## Verifying it without Azure

`apps/web/lib/runtime/fake-guest.ts` is an in-memory stand-in for the guest,
enabled with `CODEV_FAKE_GUEST=1`. It implements the same HTTP contract over a
map of files -- revisions, porcelain output, terminal sequences, and a scripted
`codex exec --json` turn that really edits the machine -- so the routes, domain
modules and poll loops run end to end in tests and under `pnpm dev`. It
declines any path it does not model, so an unmodelled call still fails rather
than quietly passing. `lib/gen2/workbench.integration.test.ts` drives the real
stack against it.

## Out of scope

Gen 1 agent sessions, worktrees, GitHub, OpenFGA, the original
`workspaces` table, and the embedded Orca IDE.

Concurrent agents: the guest serialises Codex (`start_codex_exec` waits on
`codex_busy`), so one turn runs at a time per machine. Parallelism today means
more workspaces.

Not yet built here: a browser/preview tab (live port forwarding is deferred in
`lib/runtime/preview.ts` and needs guest networking), file create/rename/delete,
Git staging and commit from the UI, and realtime fan-out between members —
two people in one workspace see each other's writes only on refresh.

## Routes

- `/gen2` — list and create
- `/gen2/[id]` — the workspace: chat plus workbench
- `/gen2/join/[token]` — accept a share link

API under `/api/gen2/workspaces/[id]`: `instance`, `share`, `chats`, `agent`,
`agent/poll`, `files`, `git`, `terminal`.

Code lives under `apps/web/lib/gen2`, `apps/web/components/gen2`, and
`apps/web/app/gen2`.
