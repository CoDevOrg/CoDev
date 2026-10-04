# ARM workspace Phase 2 — infrastructure review

**Date:** 2026-10-04. **Status:** Phase 2 infrastructure exit criteria passed.
Codex remains the only accepted agent provider. Phase 3 product database/API
integration and production enablement have not started.

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

The infrastructure controller persists a generation and operation journal in the
private `arm-workspace-state` Blob container and takes a 60-second renewable Blob
lease before mutation. It resumes expired operations under the same generation,
uses deterministic generation-owned resource names, retains disk identity across
VM replacement, and cleans failed generations before reuse. The controller is in
`infra/azure`; infrastructure tests run through `pnpm test:infra`. Product routes
must call it through the Phase 3 adapter after membership checks, never call the
VM template or shell helpers directly.

The existing disk setup is intended for disks initialized by this lifecycle path.
It intentionally refuses a legacy saved disk without private metadata. Importing
older workspace disks needs an explicit migration; it must not initialize them
as new disks.

## Evidence from the isolated canary

Subscription inspection used the signed-in Azure CLI. The canary ran only in
`codev-arm-workspace-phase1`; no production VM, web deployment, shared runtime
configuration, or product database changed.

| Check               | Observed result                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM provisioning     | Bicep deployment succeeded using accepted image `1.0.8`, generation 1, D2ps_v6, existing 16 GiB data disk. No inbound allow rule was added.                                                                                  |
| Initialization      | New-disk setup succeeded; saved UUID `0ca036ad-bf63-4bfa-abd3-638c430a2dcf`. Subsequent existing-disk setup verified that UUID.                                                                                              |
| Private metadata    | Metadata directories root:root 0700. Terminal UID 2000 could not read the saved fixture. A correctly authorized `/v1/files/read` request for the private host DB failed; service namespace masking hides the source.         |
| Actual named tunnel | Cloudflare account tunnel/configuration and temporary proxied DNS record succeeded. Protected Custom Script extension installed the connector and gateway successfully. This was a named account tunnel, not a Quick Tunnel. |
| Public HTTPS        | Signed `/v1/health` returned 200 with ready/mount/bridge true and the correct workspace/generation. Anonymous, wrong-workspace, stale-generation, and expired capabilities returned 403. `/v1/pty/exec` returned 404.        |
| Reboot              | Workspace fixture and private metadata fixture survived; UUID unchanged; guestd, Superset, gateway, and tunnel services were active after reboot. Signed HTTPS health recovered.                                             |
| Stop                | DNS and tunnel connections were removed; tunnel deleted. Cleanup observed deallocation, deleted compute/network/OS resources, and left only the durable data disk, `Unattached` with no `managedBy`.                         |
| Replacement         | Image 1.0.8 failed this check because boot-time recursive permissions changed metadata to root:codev-shell 2720. The replacement proof below validates the repaired image.                                                   |

### Rebuilt image and lifecycle canary

- [Image build `1.0.9`](https://github.com/CoDevOrg/CoDev/actions/runs/37224637267)
  succeeded. A new VM initialized disk `codev-p2proof-data` with UUID
  `7ddb1948-b876-4f47-80fe-7b9c8e0b6fad`; a generation-2 VM mounted the same
  disk after complete generation-1 teardown. Both workspace and private
  Superset fixtures survived, private metadata stayed `root:root 0700`, and
  guestd, Superset, and the local caller firewall were active. All proof VM,
  network, OS, and data disk resources were removed afterward.
- [Image build `1.0.10`](https://github.com/CoDevOrg/CoDev/actions/runs/37226212644)
  succeeded with the bridge-protected live agent activity route. Its native ARM
  build ran Rust and host-service checks. It is the exact version pinned by the
  candidate controller.
- The private Blob state container was deployed in the isolated resource group.
  [Automated canary run `37227590105`](https://github.com/CoDevOrg/CoDev/actions/runs/37227590105)
  acquired state, created a 16 GiB disk, provisioned image `1.0.10`, verified
  guest disk setup, and reached tunnel creation. `POST /accounts/.../cfd_tunnel`
  returned HTTP 403 for the repository `CLOUDFLARE_API_TOKEN`. The failure
  cleanup deallocated and deleted the VM, network, OS disk, and disposable data
  disk. An Azure resource list scoped to that canary workspace returned `[]`.
- After the repository secret was updated, the tunnel/DNS permission preflight
  passed before VM allocation. The complete
  [automated lifecycle canary `37230952626`](https://github.com/CoDevOrg/CoDev/actions/runs/37230952626)
  passed in 11m36s on image `1.0.10`. Initial start took 218 seconds and reopen
  took 348 seconds. Both ready generations used the same 16 GiB disk UUID. A
  shell-user file, direct-child Git worktree, and root-owned mode-0700 Superset
  metadata survived VM replacement; the private metadata remained unreadable to
  the shell user. Same-key start was idempotent, stop waited for deallocation,
  the live-agent-aware idle path stopped the VM after the test clock advanced
  15 minutes, and deletion removed the owned data disk using a disposable
  synthetic product-delete receipt.
- Post-run Azure inventory returned no resources tagged
  `WorkspaceId=phase2-37230952626`. A Cloudflare account/zone API inventory
  returned zero active tunnels and zero DNS records for the canary preflight
  name and lifecycle generations 1–3. The temporary preflight resources and
  workspace routes were therefore absent after cleanup.

The earlier manual tunnel canary's token transfer into local protected settings used an ephemeral encrypted
envelope; tool output contained no plaintext connector token. The extension's
public settings contained no token. This is scoped evidence, not a universal
credential-leak audit.

Both earlier manual canary VM generations were torn down. After proving retained-disk behavior,
the explicitly owned disposable test disk was deleted; it had no product workspace
record or member data. Temporary DNS/tunnel resources, keys, and local protected
settings were removed. This cleanup does not validate the product-delete contract.

## Validation

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed. Lint has existing warnings;
  the candidate files introduce no new lint diagnostics.
- 41 infrastructure tests pass, including capability rejection cases, concurrent
  start fencing, expired-operation recovery, six-failure exhaustion, 15-minute
  idle decisions, partial stop retry, tunnel-revoke failure releasing compute,
  forbidden routes, and generation-safe teardown.
- Bicep compilation, Bash syntax checks, scoped formatting, and `git diff --check`
  pass.
- `pnpm test:infra` passes all 41 tests. Coverage includes concurrent starts
  under one durable lease, transient Azure conflicts and backoff, expired
  operation recovery, retry exhaustion, partial-stop recovery, billable-compute
  cleanup after tunnel failure, and capability rejection for wrong workspace,
  generation, audience/host, issuer, scope, method, path, body digest, and time.
- The rebuilt image `1.0.9` passed the previously failing VM replacement and
  saved-metadata permission check. Image `1.0.10` published successfully and
  passed the full live lifecycle canary above.

## Acceptance and remaining gates

| Phase 2 acceptance criterion                                                              | Result                                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Create, open, idempotent retry, stop, reopen, idle-stop, and delete                       | **PASS** — live isolated canary `37230952626`                                          |
| Same saved disk UUID and files after VM replacement                                       | **PASS** — workspace file, direct-child Git worktree, and private metadata verified    |
| Azure concurrency, retries, stale-operation recovery, and partial cleanup                 | **PASS** — covered by the 41 passing infrastructure tests                              |
| Signed transport, workspace/generation/host binding, guest readiness, and secret handling | **PASS** — isolated HTTPS canary plus capability rejection tests                       |
| Canary resource cleanup                                                                   | **PASS** — no tagged Azure resources, active tunnels, or matching DNS records remained |

Phase 2's infrastructure lifecycle exit is complete. The following remain
explicit launch or later-phase gates:

1. **Phase 3 integration:** persist the runtime mapping and operation journal
   through a forward product database migration; expose thin authenticated APIs
   with membership checks before every operation; keep capability signing in
   the control plane; require a committed product-delete receipt; and schedule
   `idle()` and `reconcile()`. The isolated canary used a synthetic delete
   receipt. Do not connect this controller directly to product routes yet.
2. **Startup performance:** the single end-to-end samples were 218 seconds for
   initial start and 348 seconds for reopen. Both exceed Phase 0's later
   prepared-image target of p95 at most 120 seconds. These two observations do
   not establish a percentile; instrument the startup stages, optimize the
   slow path, then collect the planned 20-start sample before production launch.
3. **Budget proof:** the agreed $6.50 per-owner direct Azure workspace cap is
   unchanged. This lifecycle canary does not validate posted billed meters,
   full-allowance usage, variable disk I/O, egress, or applicable tax. Keep the
   free-tier release gated on the Phase 0/rollout cost acceptance.
4. **Production rollout:** Phase 2 used an isolated resource group and did not
   change product runtime routing, database state, or production deployment.
   Phase 3 integration, the cold-start target, and measured cost gates must pass
   before connecting members to ARM workspaces.

**Phase 2 is complete for its isolated infrastructure lifecycle scope.** This
review does not approve production enablement; Phase 3 and the launch gates above
remain outstanding. The agreed $6.50 direct workspace budget is unchanged.

## References

- [Cloudflare run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/)
  documents the connector's token-file option.
- [Cloudflare API tunnel setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)
  documents the account Tunnel Edit and zone DNS Edit token permissions.
- [Azure Custom Script for Linux](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/custom-script-linux)
  documents protected settings for sensitive extension input.
- [Cloudflared 2026.9.3](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3):
  ARM64 Debian package SHA-256
  `bcce0111878f13d26e66b1d2ea7f270c8bde4bd549e32ce74d32474521583ca3`.
