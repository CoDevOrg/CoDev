# ARM workspace Phase 2 — infrastructure review

**Date:** 2026-10-04. **Status:** started; incomplete. The user authorized Phase 2.
This change establishes and exercises candidate VM, disk, connection, and teardown
primitives. It does not implement the autonomous lifecycle controller, satisfy the
Phase 2 exit gate, or enable ARM workspaces in production. Codex remains the only
accepted agent provider. Phase 3 product database/API integration has not started.

## Decisions and code

| Area           | Decision                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute        | An exact gallery version, unzoned `Standard_D2ps_v6`, Standard SSD OS disk; attach one existing 16 GiB durable disk at LUN 0, caching None, `deleteOption: Detach`.                                                                                                                                                                                                  |
| Network        | A Standard IPv4 provides explicit outbound connectivity. NSG priority 100 denies **every inbound port**, including SSH. A named, remotely managed Cloudflare Tunnel reaches loopback gateway port 5260.                                                                                                                                                              |
| Authorization  | Ed25519 compact JWT, maximum 60 seconds, issuer `codev-control-plane`; bind audience, workspace ID, generation, scope, exact method/raw path, and SHA-256 body digest. Only the control plane holds the signing key. The VM stores the verification key. Membership checks and signing belong to Phase 3.                                                            |
| Gateway        | Health is authenticated and read-only; live UUID/ext4 mount and Superset bridge checks establish readiness. Forward only workspace route families to guestd. Never forward caller authorization headers; deny legacy root command/Codex execution and Claude setup routes. Reject URL path normalization and upgrades.                                               |
| Secrets        | Deliver the per-tunnel connector token through protected extension settings, then store it root-only outside `/workspace`. Cloudflared uses `--token-file`; credentials never enter a command argument or public VM custom data. No provider/member/GitHub credentials were used in this canary.                                                                     |
| Saved metadata | Keep Superset state at `/workspace/.codev-runtime/superset`, root-owned mode 0700, bind-mounted to `/var/lib/codev/codev-superset`. The `/workspace` parent is root-owned, sticky, and setgid. Mask the private source path with `InaccessiblePaths` in guestd, Superset, and gateway service namespaces. Agent credential profiles remain ephemeral on the OS disk. |
| Initialize     | Format only an explicitly new, signature-free disk whose exact byte size is 17,179,869,184. Existing disks require the saved ext4 UUID and existing private metadata. Missing or altered saved state fails closed. A repeated `new` command refuses an already formatted disk.                                                                                       |
| Stop           | Revoke routing first. Verify generation ownership, request Azure deallocation, observe `PowerState/deallocated`, delete compute, then remove remaining generation-owned networking/OS resources. Retain the data disk. A retry can clean surviving resources.                                                                                                        |

Files are under `infra/azure` and `infra/runtime/scripts`; infrastructure tests run
through `pnpm test:infra`. The template and shell helpers expect an already fenced
controller. They are **not** sufficient to serialize startup or handle lease loss.
Do not call them from product routes directly.

The existing disk setup is intended for disks initialized by this lifecycle path.
It intentionally refuses a legacy saved disk without private metadata. Importing
older workspace disks needs an explicit migration; it must not initialize them
as new disks.

## Evidence from the isolated canary

Subscription inspection used the signed-in Azure CLI. The canary ran only in
`codev-arm-workspace-phase1`; no production VM, web deployment, shared runtime
configuration, or product database changed.

| Check               | Observed result                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM provisioning     | Bicep deployment succeeded using accepted image `1.0.8`, generation 1, D2ps_v6, existing 16 GiB data disk. No inbound allow rule was added.                                                                                                                                                                                                                 |
| Initialization      | New-disk setup succeeded; saved UUID `0ca036ad-bf63-4bfa-abd3-638c430a2dcf`. Subsequent existing-disk setup verified that UUID.                                                                                                                                                                                                                             |
| Private metadata    | Metadata directories root:root 0700. Terminal UID 2000 could not read the saved fixture. A correctly authorized `/v1/files/read` request for the private host DB failed; service namespace masking hides the source.                                                                                                                                        |
| Actual named tunnel | Cloudflare account tunnel/configuration and temporary proxied DNS record succeeded. Protected Custom Script extension installed the connector and gateway successfully. This was a named account tunnel, not a Quick Tunnel.                                                                                                                                |
| Public HTTPS        | Signed `/v1/health` returned 200 with ready/mount/bridge true and the correct workspace/generation. Anonymous, wrong-workspace, stale-generation, and expired capabilities returned 403. `/v1/pty/exec` returned 404.                                                                                                                                       |
| Reboot              | Workspace fixture and private metadata fixture survived; UUID unchanged; guestd, Superset, gateway, and tunnel services were active after reboot. Signed HTTPS health recovered.                                                                                                                                                                            |
| Stop                | DNS and tunnel connections were removed; tunnel deleted. Cleanup observed deallocation, deleted compute/network/OS resources, and left only the durable data disk, `Unattached` with no `managedBy`.                                                                                                                                                        |
| Replacement         | A fresh generation-2 VM attached the same disk and reported the same UUID. **Failed acceptance:** image 1.0.8's boot-time recursive permissions changed metadata to root:codev-shell 2720, violating the saved metadata contract. The source fix removes those recursive ARM guest unit commands. A rebuilt image has not yet proved this replacement path. |

The token transfer into local protected settings used an ephemeral encrypted
envelope; tool output contained no plaintext connector token. The extension's
public settings contained no token. This is scoped evidence, not a universal
credential-leak audit.

Both canary VM generations were torn down. After proving retained-disk behavior,
the explicitly owned disposable test disk was deleted; it had no product workspace
record or member data. Temporary DNS/tunnel resources, keys, and local protected
settings were removed. This cleanup does not validate the product-delete contract.

## Validation

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed. Lint has existing warnings;
  the candidate files introduce no new lint diagnostics.
- 32 infrastructure tests pass, including capability rejection cases, HTTP health
  authorization, forbidden routes, stale-generation teardown making zero Azure
  mutations, and cleanup after a missing VM.
- Bicep compilation, Bash syntax checks, scoped formatting, and `git diff --check`
  pass.
- The Azure canary caught inherited directory setgid bits during initialization;
  explicit `chmod 00700` fixes those bits. It also caught the image permission
  problem on VM replacement; that remains a release acceptance gate.

## Remaining work and acceptance criteria

1. **Hardened image:** publish a new immutable candidate with the updated ARM guest
   unit. Re-run live Codex, local caller firewall, profile privacy, disk boot, and
   VM replacement checks. Keep image 1.0.8 out of production lifecycle selection.
2. **Fenced controller:** implement a durable operation journal and generation/lease
   handling against the Phase 0 contract. Two concurrent starts must create one
   VM attachment; retries return the same operation. An expired worker cannot
   initialize, attach, route, or delete a newer generation. Lost workers reconcile
   Azure operations before another worker takes over. No in-memory-only lock.
3. **Bounded failures:** inject allocation conflicts, starting/stopping/deallocating
   states, throttling, missing disks, attach conflicts, tunnel failure, readiness
   timeout, and partial deletion. Backoff and attempt/deadline limits must persist;
   exhaustion leaves a terminal safe error and retryable cleanup work.
4. **Idle and active work:** implement the 15-minute idle timer from recent member
   input/running agent work. Polls and health checks never renew it. An agent keeps
   running after browser closure; an idle stop confirms actual deallocation and
   deletes ephemeral billable resources.
5. **Connection lifecycle:** automate tunnel creation, encrypted token references,
   protected delivery, route revocation, and recovery. Prove rejected capabilities
   through the Worker path, wrong-host routing, signing-key rotation, unhealthy
   bridge behavior, and token refresh. The canary used control-side signing, not
   a deployed Worker membership/signing path.
6. **Delete:** accept product deletion only after its database transaction commits;
   revoke routing and stop compute before deleting exactly its owned data disk.
   Fault retries must finish without deleting another workspace's data or leaving
   billable orphan resources. The stop helper deliberately cannot delete data.
7. **Full exit matrix:** automated create/open/idle/stop/reopen/delete with concurrent
   requests and Azure faults; verify file contents, Git/worktrees, Superset
   metadata, disk identity, and privacy at every transition. Record real start
   timings and resource cleanup evidence.

**Phase 2 is not complete.** Production enablement and Phase 3 implementation are
not approved by this review. The VM replacement image fix and lifecycle controller
are the next work; none of the remaining items requires changes to hosting cost or
the agreed $6.50 direct workspace budget.

## References

- [Cloudflare run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/)
  documents the connector's token-file option.
- [Azure Custom Script for Linux](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/custom-script-linux)
  documents protected settings for sensitive extension input.
- [Cloudflared 2026.9.3](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3):
  ARM64 Debian package SHA-256
  `bcce0111878f13d26e66b1d2ea7f270c8bde4bd549e32ce74d32474521583ca3`.
