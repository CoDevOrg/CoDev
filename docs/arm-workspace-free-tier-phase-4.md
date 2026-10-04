# ARM workspace Phase 4: bridge and connection implementation

**Date:** 2026-10-04. **Status:** Implemented locally; live ARM acceptance pending.

## Implementation

The existing file, Git, terminal, agent, Superset, upload, and collaborative file
clients now resolve each workspace's provider before sending guest requests.
Firecracker uses the existing host transport. ARM uses the current generation's
workspace-specific tunnel route and a 60-second Ed25519 capability that binds
host, workspace, generation, method, exact raw path/query, and body digest.
Invalid, stopped, or mismatched ARM routes fail without contacting Firecracker.
Response adaptation preserves file revisions, save conflicts, and stream chunks.
Domain membership checks and web-owned collaboration/terminal sockets remain in
place; both sockets' filesystem operations reach the selected guest.

The gateway accepts the existing guest command and async Codex exec protocol.
Its initializer accepts only a public GitHub source URL or credential-free file
snapshots. A root-owned marker created while formatting a new disk authorizes
initialization. Protected staging records the source and publication progress;
retry can finish an interrupted publication. An initialized checkout is never
rewritten on reopen. Private snapshots retain the existing limits: 500 files,
1 MiB per file, 3 MiB total. Member/provider/GitHub credentials are absent from
bootstrap input and durable initialization metadata.

Initial open and explicit reconnect use the same lifecycle claim and persisted
progress. ARM startup verifies a bounded live read before accepting a ready row.
Closing the view aborts outstanding startup requests. A successful connection
check and reconnect do not fabricate recent member input. Progress text reuses
the existing shadcn workspace loading surface; editor mounting/layout is retained.

The guest's read-only `/v1/runtime-activity` combines direct Codex execution and
Superset agent activity. Cron observes it before idle shutdown. An unavailable
activity bridge is uncertainty, not evidence that the guest is idle. Successful
member mutations record activity with a generation fence; reads and polls do
not. Activity-write failures do not turn a successful guest mutation into a
retryable failure.

Cron also drains turns after browser polling stops. Direct ARM turns use a
nonblocking Postgres advisory claim and a persisted sequence cursor. Transcript,
cursor, exit claim, and assistant message are committed in one transaction;
only received chunks are acknowledged, including the guest's 128-chunk limit.
Completed direct turns can replay their saved reply after VM release. Superset
turns retain their existing full-snapshot persistence and credential cleanup.
Idle shutdown waits for pending turn transcripts to finish saving.

## Database and image rollout

Migration `0068_gen2_arm_turn_cursor.sql` adds `gen2_agent_turns.next_sequence`
with a non-null default of zero. It was applied after migration `0067` to the
database configured in `.env.local`; `pnpm db:check` now passes there. Run that
check against any deployment database before web start/deployment. The checker
probes both runtime columns and the cursor. An application rollback leaves the
additive column in place; do not discard saved transcript state.

Publish a candidate ARM image containing the updated `codev-guestd` protocol
before changing `ARM_WORKSPACE_IMAGE_VERSION_ID`. Startup refuses an image that
cannot report live runtime activity. The gateway/bootstrap scripts are installed
by the existing protected connection extension, and the isolated CLI installer
ships the same scripts. The new-disk marker is created by the updated preparation
script; older saved disks must already carry a checkout and are never initialized
from missing data.

## Verification and remaining acceptance

Local tests cover provider routing and generation/hostname rejection, signed
method/path/body binding, response envelopes, revision conflicts, saved checkout
preservation, traversal rejection, interrupted publication, live startup checks,
connection keepalives, idle/running-agent decisions, background draining, bounded
chunk acknowledgement, competing polls, and replay after VM release. Existing
Firecracker, Superset, chat, and collaboration tests remain required.

Verification passed: repository typecheck and lint (existing warnings only),
48 infrastructure tests, 928 web tests, the shared package suites, and 61 Rust
tests. Rust formatting and Clippy passed. Both Next.js/Webpack and Cloudflare
production builds passed. After the Cloudflare build replaced generated route
types, `next typegen` regenerated them for the final TypeScript check.
`pnpm db:check` currently fails because the new cursor column has not been
applied; this is a rollout prerequisite, not a passing database check.

Live Phase 4 acceptance still requires an isolated deployment with the user's
configured secrets/permissions, migration `0068`, and a newly built ARM image:

1. Exercise blank, public, and private repository startup; revision conflicts,
   uploads, Git, files, terminal streaming, and Codex output on the same disk.
2. Discover CoDev-managed and direct-child registered Git worktrees; confirm
   editor, Git, terminal, and agent select the same worktree.
3. Open two shared-member tabs, lose network connectivity, reopen a stale-ready
   workspace, and stop/start while an old socket is polling. Verify one startup
   operation and generation-bound requests.
4. Close every tab during a turn. Confirm it continues, its reply reaches the
   shared chat, and idle release happens only after output is durably saved.
5. Confirm a background initial tab receives its first connection check, later
   hidden health polling pauses, reconnect preserves editor drafts, and status
   checks do not extend activity or start a billing interval.
6. Measure cold-open/reconnect timing and run the separate recovery, cost, and
   production release gates. No live latency or cost result is claimed here.

No ARM image publication, production deployment, or Azure/Cloudflare resource
mutation was performed as part of Phase 4 implementation. The ARM image workflow
signs runtime artifacts only from `main`; rebuild after the Phase 4 runtime
changes are merged there, then keep the candidate excluded from `latest` until
staging acceptance.
