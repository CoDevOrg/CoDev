# Gen 2 workspace

**Status:** Current  
**Date:** 2026-10-10

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
- Own the persistent workspace count included with the billing plan; shared
  workspaces do not count
- Delete an owned workspace to remove its guest and saved disk snapshots and
  free an ownership slot
- Run up to six active sandboxes per host; idle guests hibernate after 15
  minutes and the host stays running
- Use the shared workspace hours included with the billing plan (or five
  lifetime hours on Free); shared workspace time is charged to its owner while
  the VM runs, including agent work after the browser closes
- Upload a local file onto the machine
- A workbench beside the chat — file tree with Git status, a CodeMirror 6
  editor with revision-checked saves, a shell, and a live Git status/diff
- A composer with agent commands (`/plan`, `/ask`, `/goal`, `/review`,
  `/init`), instant workspace commands (`/open`, `/changes`, `/diff`,
  `/terminal`, `/branch`, `/share`, `/preview`, `/new`, …), `@` mentions of
  files, folders, chats, agent runs, the editor selection and terminal
  output, a per-message agent switch, a chat goal with an opt-in bounded
  "Keep going", and browser dictation (on-device first)
- Agents see a bounded snapshot of what the member sees and ask the workspace
  to act through `codev-action` blocks: navigation (open a file or range,
  changes, review, terminal, preview) runs in the member's tab; invites,
  branches, worktree switches, terminal commands and new chats are proposals
  the member confirms (`apps/web/lib/gen2/README.md`)
- A Browser tab that previews a dev server on the guest through a separate
  preview domain and a guest proxy; it stays off until the preview zone is
  configured and the guest image ships the proxy (docs/WEB_HOSTING.md)

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

### Shared editor and live multiplayer (implemented, pending two-member verification)

Each workspace tab keeps **one** authenticated collaboration WebSocket. It
carries Yjs document updates for every open file (`subscribe` /
`unsubscribe`), awareness (cursors), presence, and workspace events. The tab
reports where its member is with `focus` (worktree, area, file, chat, away),
which drives the top-bar avatar stack, file-tree dots and follow mode.

Shared files **autosave**, as in other collaborative editors. Each edit fans
out to everyone first, then this socket persists its edits in order under the
document lock, which waits rather than refusing a busy document. About a second
after typing pauses (at most five seconds while it continues),
`collaboration-autosave.ts` writes the text to the workspace file with
`expectedRevision`, then tells editors with a `reconciled` (`source:
"collaboration"`) message. When an agent writes a file that has edits not yet
on disk, `lib/collaboration/text-merge.ts` merges the two by line, like Git,
and writes the merged text back. Only edits to the same lines become a conflict,
never an overwrite. The editor then offers "Keep editor version" or "Use
workspace version" (a `resolve` socket message), and the choice clears the
conflict for everyone. Members see "Saving…/Saved", with no Save button and no
save-or-discard prompt. The Yjs snapshot remains the recovery state.
A reconcile replaces only the changed lines, so collaborators' cursors survive
it. A concurrent member edit still becomes a visible non-destructive conflict.

Agents are visible while they work. Each poll of a turn
(`lib/gen2/turn-broadcast.ts`) finds files the agent newly reported changing,
reconciles any that are open **in the turn's worktree**, and places the
agent's presence (and labelled, dashed cursor) at its latest edit. Editors
type an agent's edit out (up to 2,000 characters in three hunks; larger edits
and reduced motion show at once with a flash). The document is final
immediately; only the display animates.

### Realtime fan-out

Workspace events (`lib/gen2/workspace-events.ts`) go through the room's Redis
stream, so every instance delivers them. They are published after the change
commits and never fail it:

| Event                                                             | Published by                          |
| ----------------------------------------------------------------- | ------------------------------------- |
| `chat.created`, `chat.updated`, `chat.message`                    | `chats.ts`, `chat-append.ts`          |
| `turn.started`, `turn.progress` (≤1/s, compacted), `turn.settled` | `turns.ts`, `turn-broadcast.ts`       |
| `files.changed` (user or agent actor)                             | `superset.ts`, `turn-file-sync.ts`    |
| `worktrees.changed`, `members.changed` (no emails)                | `superset.ts`, `workspaces.ts`        |
| `typing`                                                          | the socket, editors only, ≤1 per 1.5s |

Every delivery revalidates membership, in one query per broadcast. Presence
changes add an internal `presence.sync` stream entry so other instances
re-read it. Events are capped at 64 KB; a longer message is pushed as a
pointer the client refetches. Events are not replayed: after a reconnect the
client reloads chats, the thread, files and changes.

A turn's output is only recorded while something polls it. If the tab that
started a turn goes quiet for 15 s, the lowest-numbered visible editor tab
calls `POST /agent/drive`, which polls as the turn's owner (as the ARM cron
does), so the reply and agent edits still reach everyone.

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

Concurrent agents: native turns (every Cursor turn, and Codex or Claude when
`CODEV_SUPERSET_AGENT_SESSIONS_ENABLED` is off) are serialised by the guest
(`start_codex_exec` waits on `codex_busy`). Superset agent sessions, on in
production, run Codex and Claude concurrently, each in its own worktree.

Not yet built here: Git staging and commit from the UI. Agent commands are prompt-level modes; native CLI plan/goal
flags would need the Superset argv allowlist, an image release and
`agent-cli-compat.test.ts` cases. The feature-flagged
`/superset` page supports nested file/folder creation, rename, and permanent
delete through the Superset host filesystem service; each change refreshes
other members' file trees through a `files.changed` event.

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
waiting to 10 seconds; reconnect has a 480-second client budget and returns to the
retry action on expiry. ARM startup verifies
a bounded live connection before accepting persisted ready state. These
deadlines also abort outstanding requests.
Local development uses Webpack (matching the production build); `127.0.0.1`
is explicitly allowed for Next.js development resources.

The guest bridge discovers live Git worktrees from `git worktree list --porcelain`.
It accepts CoDev-managed checkouts under `.git/codev-agent-worktrees/<id>` and
single-directory agent/terminal checkouts under the primary workspace root. A
worktree must still be registered with Git and remain inside that root before
file, Git, or terminal operations resolve it. The switcher refreshes whenever it
opens, so a branch created by an agent or terminal appears without a reload.

## ARM bridge implementation

ARM workspaces reuse the workbench, agent, Superset, and collaboration clients
through signed per-workspace requests. The guest response adapter preserves
revision conflicts and terminal/agent stream shapes. New disks initialize their
checkout under protected staging; saved disks are never replaced with a fresh
checkout. Migration `0068` adds a persisted agent output cursor so cron can
finish saving turns after members close their tabs. Connection checks and poll
requests do not extend activity; live agent work and member input do.

This is implemented but awaits ARM image publication and live staging
acceptance. Existing Firecracker workspaces remain the default. See the
[Phase 4 review](./arm-workspace-free-tier-phase-4.md) for the remaining gates.
