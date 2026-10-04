# Gen 2 workspace

**Status:** Current  
**Date:** 2026-09-30

Gen 2 is CoDev's active workspace implementation. The product is:

> A workspace is a Firecracker cloud instance you can share, and you and Codex
> work on it together.

Unlike the previous workspace design, Gen 2 has **one filesystem**. There is
only the guest — Codex runs
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
  minutes and the host stays running
- Use up to 1,000 VM minutes per UTC month across all workspaces you own;
  shared workspace time is charged to its owner while the VM runs, including
  agent work after the browser closes
- Upload a local file onto the machine
- A workbench beside the chat — file tree with Git status, a CodeMirror 6
  editor with revision-checked saves, a shell, and a live Git status/diff

## No start button

Opening a workspace is the intent to use it, so `ensureGen2Instance` runs on
open and is safe for any member to call -- the person who follows a share link
should not have to wait for the owner to press something. The composer is
never disabled either: type into a cold workspace and the machine is brought
up as part of sending. The orchestrator hibernates an idle guest after fifteen
minutes, preserving its workspace disk while releasing its sandbox slot. Once
no active guest keeps the host active, it deallocates after a one-minute quiet
window checked every thirty seconds. Opening the workspace resumes it from the
saved disk. Owner-initiated stops also checkpoint durable guests. Graceful
orchestrator shutdown drains requests and saves guest disks before stopping
Firecracker; interrupted live disks are recovered on the next open. Recovery
includes both the workspace disk (Git worktrees and uncommitted files) and the
root disk (Superset host state). Existing workspace recovery fails explicitly
when saved data is missing; it must not create a fresh checkout as a fallback.

## Interface

Chat is the primary column. The workbench on the right collapses to an icon
rail and has three tabs: Files (tree + editor), Terminal, and Git. It is
modelled on an agent UI, not an IDE: the chat is where the work is directed,
and the workbench is how you watch and intervene.

### Shared editor (implemented, pending two-member verification)

The open Superset-style file editor now uses a CoDev-backed Yjs document rather
than browser polling for filesystem changes. A Gen 2-scoped authenticated
WebSocket carries document updates, awareness/presence, reconnects, and
conflicts. CodeMirror binds directly to the document; the editor shows shared,
syncing, and conflict state.

Filesystem writes remain explicit, revision-checked saves. The Yjs snapshot is
recoverability and collaboration state, not a replacement durable filesystem.
When Codex reports that it changed an open file at turn completion, CoDev
reconciles the shared document with the saved file; a concurrent member edit
becomes a visible non-destructive conflict. Remote cursor decorations and
richer member presence remain follow-up work.

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

When a turn ends, the tree and Git panel refresh. An open shared document is
reconciled from Codex's reported file changes instead of a browser filesystem
poll. Saves carry `expectedRevision`, so a stale write is a 409 with the
current revision rather than a silent clobber.

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

The previous Gen 1 workspace runtime and its application code have been
removed. Historical database migrations and stored records remain intact.

Concurrent agents: the guest serialises Codex (`start_codex_exec` waits on
`codex_busy`), so one turn runs at a time per machine. Parallelism today means
more workspaces.

Not yet built here: a browser/preview tab (live port forwarding is deferred in
`lib/runtime/preview.ts` and needs guest networking), Git staging and commit
from the UI, and realtime fan-out between members. The feature-flagged
`/superset` page supports nested file/folder creation, rename, and permanent
delete through the Superset host filesystem service; that page is separate from
the shared CodeMirror/Yjs editor and two people using it still see each other's
writes only on refresh.

The Superset host artifact and private guest bridge are real guest-side reuse,
not a browser mock. Future Superset work must extend that host service to
replace the matching Gen 2 terminal, Git/worktree, and agent mechanics; do not
add duplicate `codev-guestd` implementations. CoDev continues to own member
authorization, provider credentials, quotas, Yjs documents, conflicts, and
durable product history.

## Routes

- `/gen2` — list and create
- `/gen2/[id]` — the workspace: chat plus workbench
- `/gen2/join/[token]` — accept a share link

API under `/api/gen2/workspaces/[id]`: `instance`, `share`, `chats`, `agent`,
`agent/poll`, `files`, `git`, `terminal`, `collaboration`.

Code lives under `apps/web/lib/gen2`, `apps/web/components/gen2`, and
`apps/web/app/gen2`.

### Workspace connection UI

Connected workspaces show no machine or VM badge. A live, authenticated connection
check runs every 30 seconds while the page is visible and does not wake a sleeping
guest. Keyboard, input, pointer, and scroll activity send throttled keepalives;
hidden or idle pages stop sending them. The runtime hibernates after its configured
idle timeout (15 minutes by default). Agent work also counts as activity.

A sleeping or unavailable workspace shows **Reconnect** in the top navigation.
One click shares a single reconnect attempt, shows **Reconnecting…**, then refreshes
the panels without remounting the editor or clearing drafts. Existing workspaces
are not silently awakened by status checks; new pending workspaces connect once.
Connection failure leaves a retry action and a useful error. Runtime status reads
must not extend the idle timer, and the persisted `ready` database status alone is
not proof of connectivity.

The initial check runs even when the workspace opens in a background tab. Later
checks pause while hidden. Connection checks bound network and response-body
waiting to 10 seconds; reconnect has a 240-second client budget and returns to the
retry action on expiry. These deadlines must also abort outstanding requests.
Local development uses Webpack (matching the production build); `127.0.0.1`
is explicitly allowed for Next.js development resources.

The guest bridge discovers live Git worktrees from `git worktree list --porcelain`.
It accepts CoDev-managed checkouts under `.git/codev-agent-worktrees/<id>` and
single-directory agent/terminal checkouts under the primary workspace root. A
worktree must still be registered with Git and remain inside that root before
file, Git, or terminal operations resolve it. The switcher refreshes whenever it
opens, so a branch created by an agent or terminal appears without a reload.
