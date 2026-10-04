# ARM Superset isolation integration

**Status:** Planned  
**Scope:** Safely carry the Superset teammate-isolation baseline into the
disposable ARM workspace lifecycle.

ARM keeps the durable `/workspace` disk and backend records, then deletes the
VM and its OS disk. It must therefore never rely on a hibernated machine,
runtime memory, an OS-disk profile, or a local Superset database to survive a
stop.

## Steps

1. **Finish the ARM lifecycle boundary first.** Use the durable, generation-fenced
   controller as the only caller that starts, stops, reconnects, and deletes an
   ARM workspace. Do not wire product agent routes directly to the canary
   helpers. A running agent must keep the idle timer alive; connection polls and
   health checks must not. Count actual editor mutations as member input, but
   never count presence, keepalives, or connection checks. Before attaching a
   durable disk to a new generation, confirm its old VM is gone and the disk is
   `Unattached`.

2. **Make ownership explicit.** Persist Agent Session/run state, provider
   selection, worktree, owner, output, credential revision, and lease in the
   backend. Keep code, Git data, worktrees, and root-owned Superset metadata on
   `/workspace`. Keep launch profiles, tokens, sockets, and processes on the
   disposable OS disk only.

3. **Preserve workspace ownership across disposable VMs.** Keep the existing
   stable workspace group, setgid `/workspace` directories, and `umask 0002`.
   Per-launch UIDs remain private identities but use that shared group, so files
   created under one VM/UID stay editable after a later VM gets a new UID. Add a
   fresh-VM ownership test before relying on this contract; do not introduce
   idmapped mounts unless that test finds a concrete gap.

4. **Adapt agent launch to the ARM guest.** For every launch, resolve the
   initiating member's personal credential, claim its exclusive subscription
   seat, allocate a fresh unprivileged UID, and materialize a private
   per-launch profile outside `/workspace`. Use one worktree per independent
   task; follow-ups reuse that task's worktree. Never place profiles or OAuth
   files in the image, durable disk, or Superset durable metadata.

5. **Move run supervision to the control plane.** A server-owned monitor must
   continue after the browser closes: observe guest process liveness, append
   safe output, renew the credential seat, and capture refreshed credentials
   periodically or after verified profile changes while the process is live.
   Each capture, heartbeat, release, and write-back must carry an opaque
   per-claim seat token as well as the launch-time credential revision. The
   backend accepts a write only while both are current. A lost guest or monitor
   becomes recovery-required, never silently complete; an invalid saved refresh
   token becomes the existing `reauthorization_required` credential state.

6. **Replace Firecracker checkpoint cleanup with fenced teardown.** Mark the
   current generation stopping to block new launches, revoke its route, flush
   Yjs/filesystem writes, stop agents and terminals, capture and acknowledge
   refreshed credentials, release seats, then sync and unmount `/workspace`
   before deleting the VM and OS disk. Profile deletion is defense in depth;
   the disposable OS disk is the final cleanup boundary. A failed credential
   write-back or unconfirmed stop must leave lifecycle cleanup retryable rather
   than delete the only recoverable token update.

7. **Preserve teammate boundaries and durable-disk hygiene.** Keep terminals owner-only until product
   grants have per-member guest identities. Keep `/proc`/ptrace hardening,
   non-root agent UIDs, `nosuid,nodev` workspace mounts, and root-only durable
   Superset metadata in the ARM image. Keep CLI homes and XDG state in the
   private profile, and provide Git authentication only through an ephemeral
   helper or broker—never remote URLs, `.git/config`, or workspace files.
   Secret-pattern checks may warn about accidental files but are not an access
   control. Clearly retain the residual risk that an authenticated CLI can run
   malicious workspace code as itself.

8. **Recover deliberately after an unclean stop.** On the next generation, mark
   previously live sessions recovery-required, run `git worktree prune`, and
   remove only validated stale Git locks after confirming no process can own
   them. Add encrypted, retention-bounded Azure disk snapshots as a separate
   disaster-recovery feature, never as runtime resume.

9. **Build the product interface on the new session records.** Add the Agent
   Sessions panel only after the lifecycle contracts exist: new task creates a
   session/worktree, follow-up targets the live session, and detail presents
   safe progress, stop/restart, ownership, and branch/worktree. Do not restore
   old Firecracker roster or hibernation routes wholesale.

10. **Prove lifecycle transitions before rollout.** Test launch, browser-close,
    idle stop, explicit stop, VM loss, restart on a fresh VM, member removal,
    credential disconnect, and workspace deletion. At each transition verify
    durable files/worktrees and backend sessions survive when intended, while
    profiles, tokens, processes, and terminals do not. Include a monitor crash
    followed by seat expiry, two controllers racing, failed disk detach or hung
    VM deletion, token refresh during VM loss, and fresh-VM file ownership.

## Do not port unchanged

Do not carry over Firecracker disk-snapshot callbacks, checkpoint-profile scans,
or assumptions that a guest-side runtime database survives a stop. The ARM
lifecycle already retains only the workspace disk; the correct equivalent is
control-plane credential capture and fenced VM teardown.

## Provider policy

Keep one active subscription-backed run per member credential across all
workspaces until provider token rotation and terms are verified for the current
CLI authentication flows. A provider-supported non-rotating setup-token flow
may justify a separate parallel-run policy later; it is not assumed here.
