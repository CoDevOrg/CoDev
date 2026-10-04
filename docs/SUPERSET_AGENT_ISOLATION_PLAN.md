# Superset agent isolation plan

**Status:** In progress  
**Date:** 2026-10-03

## Objective

Run multiple teammates' agents safely in one Gen 2 Firecracker workspace while
keeping the shared filesystem model and each member's provider credentials
private from other members' agents and terminals.

## Implementation order

1. Keep one Firecracker guest and one shared `/workspace`. Give every agent
   launch a fresh unprivileged UID and private credential profile; do not add a
   long-lived private home per member.
2. Use one worktree per independent task. Retries and follow-up prompts reuse
   that task's worktree; cooperating subagents normally share it.
3. Keep Gen 2 personal-credential-only and retain the existing resolver and
   run-derived credential seat. Renew the seat from verified process liveness,
   not terminal output.
4. Move polling, refresh capture, write-back acknowledgement, and profile
   cleanup to a server-owned monitor that does not depend on an open browser.
5. Gate every disk checkpoint on quiescing Superset agents, persisting refreshed
   credentials, removing private profiles, and verifying that no provider
   material remains. Hibernation must fail closed when this cannot be proven.
6. Make terminals owner-only by default. A later explicit grant must use a
   member-specific terminal identity rather than the shared `codev-shell` UID.
7. On membership or credential revocation, stop affected runs, release seats,
   close terminals, and remove profiles before completing revocation.
8. Add `/proc` and ptrace hardening, then evaluate user namespaces or
   bubblewrap on the real guest image. These are defense in depth, not a
   substitute for the credential lifecycle above.

## Security boundary

This tier isolates one member's live credential from another member's terminal
or agent. It does not promise that code another editor writes is safe to run:
the authenticated CLI and its tool subprocesses currently share an identity,
and the approved Codex and Claude commands bypass their built-in permission
sandboxes. That residual risk must remain explicit unless tool subprocesses
receive a separate credential-free boundary.

## Current progress

- Per-launch UIDs and private profiles are implemented.
- Independent starts receive separate worktrees; idempotent retries reuse the
  same worktree.
- Personal credential resolution and run-derived seats are implemented.
- Quiet live agents now renew their credential seat from host-confirmed process
  liveness.
- New launches now dispatch a server-owned monitor that long-polls the host,
  renews seats from verified liveness, writes refreshed auth before marking a
  run finished, and marks a run recoverable if monitoring fails. Profile
  cleanup verification remains next.
- Checkpointing now blocks new Superset launches and fails closed while an
  agent terminal or profile remains. A failed Firecracker checkpoint reopens
  the guest so launches are not left permanently blocked.
- Idle checkpointing now calls the authenticated control plane first, which
  stops tracked runs, captures refreshed credentials, and releases seats;
  the guest then independently verifies private profile cleanup before disks
  are copied. A refused or unavailable callback fails closed.
- Terminal operations and stream rechecks are now owner-only. Explicit member
  terminal grants, with separate guest identities, remain future work.
- Member removal and credential deletion now stop affected Superset agents
  before revoking access, releasing seats and removing live profiles first.
- Refresh write-back now compares the launch-time opaque credential revision,
  so a stale profile cannot overwrite newer encrypted OAuth material.
- Guest images now mount `/proc` with `hidepid=2` and set Yama ptrace scope 2.
  Namespace or bubblewrap compatibility remains to be evaluated on a live VM.
