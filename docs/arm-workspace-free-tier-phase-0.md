# ARM workspace free-tier: Phase 0 decision record

**Review date:** 2026-10-03\
**Scope:** Gen 2 workspace runtime, Azure West US 2\
**Decision:** Phase 0 findings are complete. Phase 1 is ready to begin as an isolated ARM image and workload validation phase, but not as a product rollout. Wait for the user's approval before starting Phase 1.

## Summary

- Keep **Standard_D2ps_v6** as the cost target. A real unzoned West US 2 allocation succeeded. The subscription catalog marks zones 1 and 2 unavailable; current regional quota leaves theoretical capacity for 28 additional two-vCPU VMs.
- Use one VM for the currently active workspace and delete the VM, its managed OS disk, and its egress IP on stop. Keep only each workspace's durable E3 data disk. A retained VM/OS disk does not fit the $6.50 cap.
- Use a per-active-VM Cloudflare Tunnel for the runtime path. Give the VM a Standard public IPv4 only for explicit outbound connectivity; deny all inbound traffic at the NSG and expose no VM IP to callers. A temporary Quick Tunnel proved outbound reachability, not production routing or authentication.
- The E3 disk passed the synthetic I/O thresholds at queue depth 4 and retained data across five VM replacements. Full repository/install/build occupancy was not tested; the checkout alone is about 8.1 GiB, so the 16 GiB capacity decision remains conditional.
- Publish an async, idempotent runtime lifecycle API, generation-fenced resource mapping, and owner-level active-workspace lock as described below.
- The budget scope is direct Azure workspace resources; app hosting and shared control-plane costs are excluded. Under the explicit 5 GB egress and one million billable I/O units per managed disk sensitivity, the one-workspace choice totals $5.924 and the two-workspace choice $6.347 before tax. Both fit the $6.50 cap before tax; the two-workspace case leaves only $0.153 for Azure cost variation and tax. Actual usage and tax are not yet known.

The disposable canary used resource group `rg-codev-arm-canary-20261003`, VM `vm-arm-phase0`, and data disk `disk-arm-data-e3`; the resource group was fully deleted after testing and the temporary SSH key was removed. No product code, production resources, or deployments were changed for the canary. Azure CLI was already authenticated to the enabled subscription. Unrelated pre-existing working-tree changes were left untouched.

## Decisions

### Region, SKU, quota, and availability

West US 2 remains the candidate region: `infra/azure/deploy.sh` defaults to `westus2`, and the existing `codev-runtime-host` is in that region. The current subscription has an enabled Azure account and an existing `Standard_D8s_v7` host.

Azure SKU/quota queries and a disposable VM allocation on 2026-10-03 returned:

| Check                             | Result                                                               | Decision                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Standard_D2ps_v6 catalog          | Listed in westus2; 2 vCPU, 8 GiB, Arm64                              | Hardware target is represented in the regional catalog.                                                                                  |
| D2ps_v6 subscription restrictions | `NotAvailableForSubscription` in zones 1 and 2                       | Do not select zones 1 or 2. A fresh unzoned allocation succeeded; this does not guarantee future regional capacity.                      |
| Regional vCPU quota               | 8 used of 65; 57 available after canary cleanup                      | At most 28 additional two-vCPU VMs fit this quota, assuming no other consumers. Request a larger regional quota before a larger rollout. |
| Standard Dpsv6 family quota       | 0 used of 350                                                        | Family quota is sufficient for the current regional headroom.                                                                            |
| Standard SSD managed disk quota   | 0 used of 50,000 before canary                                       | No disk-count quota issue appeared for this design.                                                                                      |
| Standard_D2pds_v6 alternative     | Same westus2 catalog and zone 1/2 restriction; family quota 0 of 350 | The alternative is region-listed, but allocation is likewise unproven.                                                                   |

The canary VM was Standard_D2ps_v6, Ubuntu 22.04 ARM64, 2 vCPU/8 GiB, and unzoned in West US 2. It reached `VM running` and the Azure guest agent reached `Ready`; it was then deleted. This proves a disposable allocation in the tested region at that time, not guaranteed availability for later starts or a production-scale peak.

### VM and OS-disk lifecycle

Standard_D2ps_v6 provides 2 Arm64 vCPUs and 8 GiB RAM, supports Standard SSD data disks, has no local disk, and does not support ephemeral OS disks. Use an E4 32 GiB Standard SSD for the OS disk while the VM exists, then delete it with the VM. This keeps the OS and agent files out of `/workspace` and avoids paying for a retained OS disk through the idle portion of the month.

Standard_D2pds_v6 is a considered alternative. It has 110 GiB local NVMe storage and supports ephemeral OS disks, but costs $0.0918/hour versus $0.0702/hour for D2ps_v6. At 50 hours, D2pds_v6 plus one E3 disk and active-only IP costs $6.04 before variable costs, leaving only $0.46 under the $6.50 budget for egress, data-disk operations, and tax. Its faster local disk does not compensate for its higher compute rate under the current limits. Reconsider it if retained-OS lifecycle or cold-start evidence changes the tradeoff.

On stop, delete the VM, OS disk, network interface, public IP, and runtime operation lease. Retain the workspace E3 disk and the prepared image version. On the next start, create a fresh VM, attach the same durable disk, mount it at `/workspace`, and increment the workspace generation. Never create a replacement data disk when an existing disk is missing.

### Connection and security architecture

Use one remotely managed Cloudflare Tunnel for each **active VM**, with an opaque runtime hostname. Cloudflare Tunnel is available on all plans and supplies the public TLS endpoint. The VM runs `cloudflared` as a system service and exposes the runtime only on loopback. The Cloudflare Worker control plane calls the hostname and authenticates every runtime request; browsers do not receive tunnel credentials or Azure credentials.

Azure's post-March-31-2026 behavior makes new virtual network subnets private by default. A fresh VM therefore needs an explicit outbound method. For the initial design, attach a Standard IPv4 public IP while the VM is active, use it only for outbound tunnel and workspace traffic, and delete it on stop. Create no inbound NSG allow rules, including SSH or the runtime port. The tunnel daemon initiates outbound TCP/UDP 7844 connections. This keeps the runtime off a direct public endpoint while avoiding a permanent NAT Gateway charge.

Keep the Cloudflare account API token in backend secrets. Create a tunnel token scoped to one tunnel, store its secret reference encrypted in control-plane storage, and deliver it through protected VM extension settings. Do not put it in custom data, URLs, ordinary logs, member credentials, or workspace files. Revoke the tunnel when its VM stops or workspace is deleted. A separate short-lived CoDev-signed capability must bind each request to its workspace, generation, audience, expiry, and allowed scope; the guest contains only the verification key. The tunnel token authenticates the connector, never workspace authorization. The Worker checks membership before signing; the guest rejects invalid, expired, wrong-workspace, stale-generation, and out-of-scope capabilities. A shared tunnel token must never authorize access to another workspace.

The canary NSG had an explicit deny-all inbound rule. External probes to ports 22, 80, 443, and 8080 timed out. A loopback-only test HTTP service reached through a temporary Cloudflare Quick Tunnel returned the expected 200 response from inside the guest. The tunnel and test service were stopped before the canary resource group was deleted. This demonstrates outbound tunnel connectivity only: no named account tunnel, Cloudflare Worker-to-runtime route, production token delivery, signed-capability validation, or cross-workspace authorization was deployed or tested. Quick Tunnels are temporary and public to anyone holding their random URL; the canary returned only a harmless fixed string and its URL was not retained.

The per-VM tunnel avoids one Azure ingress gateway. Cloudflare currently documents limits of 1,000 tunnels and 1,000 routes per account, so lifecycle operations must be queued and the account limit must be revisited before scaling beyond that ceiling. At present, Azure's 28-VM regional headroom is the tighter limit.

| Option                                              | Recurring cost and behavior                                                                                                                                                                                                                                                                                           | Decision                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Per-active-VM Cloudflare Tunnel with egress-only IP | Tunnel has no separate plan charge. Standard IPv4 is $0.005 per VM-hour; Internet egress can reach $0.08/GB. No inbound VM access.                                                                                                                                                                                    | **Selected.** Lowest fixed cost at current scale and no public runtime endpoint.                                     |
| Cloudflare Tunnel with no VM IP                     | Needs explicit shared outbound access. The public baseline used here is $0.045/hour ($32.85 per 730-hour month), plus $0.045/GB processed and Azure bandwidth egress. Shared charge is $32.85 divided by free-owner months, before traffic; reconfirm with the Azure pricing calculator before selecting this option. | Revisit when adoption and traffic measurements support a shared allocation.                                          |
| Azure Application Gateway Standard v2               | $0.20/hour base ($146 per 730-hour month), $0.008 per capacity unit-hour, and a public IP. A shared gateway has a large fixed owner allocation at early scale.                                                                                                                                                        | Rejected for the first version on cost and added central routing operations.                                         |
| Direct TLS endpoint on every active VM              | Same active Standard IPv4 charge, plus certificate lifecycle and an inbound 443 service on every VM.                                                                                                                                                                                                                  | Rejected in favor of outbound tunnels, which remove inbound runtime access and per-VM origin certificate management. |

The production named-tunnel route and Cloudflare Worker-to-tunnel path still need an end-to-end proof. The canary did not change Cloudflare account configuration or application wiring.

### Runtime API and data contract

**Control-plane APIs**

| Method and path                                                           | Contract                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/gen2/workspaces/{workspaceId}/runtime/start`                   | Require an authenticated member, workspace authorization, owner quota, and `Idempotency-Key`. Return 202 with `{ operationId, workspaceId, generation, status: "queued", pollAfterMs }`. The same key returns the same operation.                                 |
| `GET /api/gen2/workspaces/{workspaceId}/runtime/operations/{operationId}` | Return persisted progress and a safe error code. This read never wakes a VM, extends idle time, or counts as member activity.                                                                                                                                     |
| `POST /api/gen2/workspaces/{workspaceId}/runtime/stop`                    | Require authorization and an idempotency key. Return 202 and reconcile asynchronous cleanup.                                                                                                                                                                      |
| `POST /api/gen2/owners/{ownerId}/active-workspace`                        | Require an explicit requested workspace, expected current workspace, confirmation to stop it, and an idempotency key. A mismatch returns 409 with `ACTIVE_WORKSPACE_CONFLICT` and the current workspace; never stop another member's active workspace implicitly. |

The route handler validates and delegates to `apps/web/lib/`; it contains no Azure or lifecycle business logic. Check membership before every runtime command and status read. An ordinary status read does not wake a VM.

**Runtime endpoints**

- `GET /v1/health` returns the runtime generation, bridge version, disk identity/mount result, and component readiness. It requires a short-lived signed capability. Only after the live bridge check succeeds may persisted state become `ready`.
- `POST /v1/stop` is authenticated, asynchronous, and idempotent. Existing workspace file, Git, terminal, agent, and Superset commands use the same authenticated workspace-scoped runtime adapter.
- The VM reports no access tokens, repository credentials, provider credentials, or secrets in URLs, status, or errors. Health checks do not count as keepalive activity.

**Persisted contract**

One `workspace_runtime` record is keyed by workspace and holds `provider`, `location`, `vmSize`, nullable VM resource ID, durable `dataDiskResourceId`, `tunnelId`, opaque route host, monotonic `generation`, lifecycle state, current operation ID, operation lease expiry, and lifecycle timestamps. Secret tunnel material is stored only as an encrypted secret reference.

One `runtime_operation` record holds operation ID, workspace ID, owner ID, kind, idempotency key, generation, state, retryability, safe error code, and timestamps. Enforce uniqueness on `(workspaceId, idempotencyKey)`. The owner-active claim is serialized in the database with one active workspace per free owner. The durable owner-month usage ledger remains separate so deleting a workspace cannot reset usage.

Lifecycle states are `stopped`, `queued`, `provisioning`, `booting`, `attaching_disk`, `starting_tunnel`, `checking_readiness`, `ready`, `stopping`, and terminal `failed`. Stale workers are fenced by generation and lease. Safe error codes include `SKU_UNAVAILABLE`, `QUOTA_EXCEEDED`, `ALLOCATION_FAILED`, `DISK_MISSING`, `DISK_ATTACH_CONFLICT`, `TUNNEL_FAILED`, `READINESS_TIMEOUT`, `ACTIVE_WORKSPACE_CONFLICT`, and `STOP_FAILED`.

### Disk and cold-start benchmark

The target E3 was a 16 GiB StandardSSD_LRS managed disk, formatted ext4 and attached at LUN 0. `fio` used direct I/O and a 4 GiB test file. Each random run lasted 60 seconds:

| Test                                | Measured result                                                                                        | Phase 0 interpretation                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sequential 1 MiB direct write/read  | 145.10 / 145.11 MiB/s                                                                                  | Exceeds the 80 MB/s target in this run. It is above the 100 MB/s published E3 base ceiling, likely reflecting burst behavior; do not model this as sustained throughput. |
| 4 KiB 50/50 random read/write, QD4  | 304.89 read + 303.92 write = 608.81 aggregate IOPS; p95 7.44 / 6.85 ms                                 | Meets the 400 aggregate IOPS and 10 ms p95 synthetic thresholds at this queue depth.                                                                                     |
| 4 KiB 50/50 random read/write, QD32 | 304.57 read + 303.77 write = 608.34 aggregate IOPS; p95 54.8 / 54.3 ms                                 | Latency exceeds the 10 ms target under deeper queueing; workload concurrency and queue depth need tuning.                                                                |
| Disk-full smoke                     | `fallocate` reached ENOSPC; after removing the filler, the 4 GiB benchmark file checksum still matched | Basic file integrity recovered. This does not test CoDev application behavior on ENOSPC.                                                                                 |

After the benchmark file, the volume showed 4.1 GiB used and 11 GiB free. The current CoDev checkout is about 8.1 GiB across `.git`, `vendor/superset`, root `node_modules`, and `apps/web/node_modules`, before build output and extra worktrees. The actual checkout, `pnpm install`, production build, two worktrees, and CPU-saturated build were not run on this E3. Capacity and workload acceptance therefore remain open.

Fresh-create timing included submitting VM creation and polling Azure instance view until the VM was running and its guest agent reported `Ready`. Each trial used a fresh Ubuntu 22.04 ARM64 OS disk and attached the same durable E3 disk:

| Trial      | VM running | Guest agent ready |
| ---------- | ---------: | ----------------: |
| 1          |     19.6 s |            36.5 s |
| 2          |     13.8 s |            35.7 s |
| 3          |     18.8 s |            29.8 s |
| 4          |     18.6 s |            35.2 s |
| 5          |     18.2 s |            40.1 s |
| **Median** | **18.6 s** |        **35.7 s** |

The same E3 disk and its 4 GiB file were remounted and verified after the fifth replacement. Timings start before `az vm create --no-wait`; Azure instance view was polled every four seconds. These samples measure Azure allocation, stock OS boot, disk attachment availability, and guest-agent readiness only. They do not measure image provisioning, `cloudflared` registration, CoDev bridge readiness, or application startup. Five runs are useful path evidence, not the 20-run production SLO sample.

### Cost worksheet

Rates below are the West US 2 public USD retail inputs read on 2026-10-03, excluding tax and any negotiated subscription discounts:

| Meter                                        |                                                                                                           Rate used |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------: |
| Standard_D2ps_v6 Linux VM                    |                                                                                                    $0.0702 per hour |
| Standard_D2pds_v6 Linux VM, comparison only  |                                                                                                    $0.0918 per hour |
| Standard SSD E3 LRS 16 GiB durable data disk |                                                                                                $1.20 per disk-month |
| Standard SSD E4 LRS 32 GiB transient OS disk |                                                                        $2.40 per disk-month, prorated by disk-hours |
| Standard IPv4 Public IP                      |                                                                                                  $0.005 per IP-hour |
| Internet data transfer out                   |  Up to $0.08 per GB after any subscription-level free allowance; the worksheet conservatively assumes the paid rate |
| Standard SSD I/O operations                  | $0.002 per 10,000 billable 256-KiB-equivalent operations; measured volume and the hourly billable cap are not known |

The D2psv6 lifecycle includes one transient E4 OS disk and one active egress IP. Disk and VM resource-hours are modeled as exactly the allowed compute hours, and use 730 hours for a representative month. Provisioning and teardown time must count against the owner's allowance; actual billed hours will vary with session shape.

| Free choice                     |     VM | Durable E3 disks | Transient E4 OS disk | Active IP | Fixed subtotal | Headroom before variable meters |
| ------------------------------- | -----: | ---------------: | -------------------: | --------: | -------------: | ------------------------------: |
| One workspace, 50 hours         | $3.510 |           $1.200 |               $0.164 |    $0.250 |     **$5.124** |                          $1.376 |
| Two workspaces, 35 shared hours | $2.457 |           $2.400 |               $0.115 |    $0.175 |     **$5.147** |                          $1.353 |

Keeping the OS disks for the full month instead changes the known subtotals to $7.11 and $9.657, before any public IP or variable charges. It fails the cap. Leaving a Standard public IP allocated for the full month would add a further $3.65 per workspace. The selected lifecycle deletes both resources on stop.

**All-in direct Azure estimate under a sensitivity scenario, not a measured forecast:** at 5 GB of egress per owner, egress adds $0.40 at $0.08/GB. At one million billable I/O units per managed disk, each managed disk adds about $0.20. An E3 data disk plus transient E4 OS disk adds $0.40 for one workspace; two E3 disks plus the OS-disk hours add about $0.80 for two workspaces. The modeled totals are:

| Free choice                     | Fixed subtotal | Egress assumption | Disk I/O assumption | Modeled direct Azure total, pre-tax | Headroom under $6.50, pre-tax |
| ------------------------------- | -------------: | ----------------: | ------------------: | ----------------------------------: | ----------------------------: |
| One workspace, 50 hours         |         $5.124 |            $0.400 |              $0.400 |                          **$5.924** |                    **$0.576** |
| Two workspaces, 35 shared hours |         $5.147 |            $0.400 |              $0.800 |                          **$6.347** |                    **$0.153** |

These are all modeled direct workspace-resource charges in scope: VM compute, durable workspace disk(s), transient OS disk hours, active public IP hours, egress, and managed-disk operations. They are **not tax-inclusive**: public retail inputs do not establish the Azure billing account's applicable tax, and actual egress/I/O have not been observed for a CoDev workload. If tax is proportional to these amounts, effective tax above 9.7% for one workspace or 2.4% for two workspaces would push that choice over $6.50 even at the stated usage assumptions. Do not represent either total as a guaranteed invoice amount.

For a full calculation, use:

- One workspace: `$5.124 + ($0.08 × owner egress GB) + ($0.002 × billable I/O units / 10,000) + applicable tax`.
- Two workspaces: `$5.147 + ($0.08 × owner egress GB) + ($0.002 × billable I/O units / 10,000) + applicable tax`.

This budget covers direct Azure workspace resources: VM compute, durable E3 data disks, transient E4 OS disks, active public IPs, egress, and managed-disk operations. It excludes application hosting, database/Redis, shared image-gallery and artifact storage, shared monitoring, and control-plane services. Apply any subscription-level egress allowance once at the subscription level rather than once per owner. Current resource-group Cost Management meters combine the existing x86 runtime and shared services, so they cannot yet validate the direct per-workspace bill. Public retail estimates are before any applicable taxes.

**Cost decision:** both choices fit the $6.50 per-owner cap in the stated pre-tax sensitivity scenario. The two-workspace estimate leaves only $0.153 before tax and other Azure cost variation. The fixed subtotals and sensitivity meters are estimates, not measured bills; canary cost data has not posted as a per-workspace meter. Validate workload-derived egress and disk operations and confirm applicable tax before treating the cap as proven.

## Unresolved risks

- Allocation was proven once with an unzoned VM. Capacity can vary later; zones 1 and 2 remain unavailable and the regional quota permits at most 28 additional two-vCPU VMs before considering competing consumers.
- The 16 GiB disk passed synthetic I/O at QD4, but QD32 p95 latency exceeded the target. The 8.1 GiB checkout, install, build, extra worktrees, and CPU-saturated build were not measured on the disk; usable capacity is unproven.
- Five stock-image cold starts reached guest-agent readiness in 29.8–40.1 seconds. CoDev image setup, tunnel registration, bridge readiness, and end-user request latency remain unknown.
- Standard SSD I/O transaction charges and owner egress are variable. The sensitivity case leaves only $0.153 under the workspace-resource budget for the two-workspace choice before applicable tax or other Azure cost variation.
- Production named-tunnel creation, teardown, routing, API rate handling, authentication, Cloudflare Worker-to-tunnel reachability, and account tunnel/route limits need an end-to-end proof.
- The free allowance currently charges user-visible hours only by the plan description; billing starts while Azure resources provision. If those startup minutes are not included in the allowance, repeated short sessions increase cost outside the worksheet.
- The selected egress-only public IP depends on the NSG staying deny-all inbound. The canary blocked tested ports and had an explicit deny rule, but production policy must enforce and continuously probe the complete rule set.

## Phase 0 exit checks and Phase 1 validation gates

Phase 0 findings are complete. The checks below distinguish what was proven in the disposable canary from the workload and production gates that remain for a later phase:

1. **Subscription and allocation — PASS:** the D2ps_v6 catalog lists the SKU; zones 1 and 2 are restricted; an unzoned 2-vCPU/8-GiB ARM VM was created and deleted successfully. After cleanup, regional quota was 8/65 and Dpsv6-family quota 0/350, leaving theoretical space for 28 more two-vCPU VMs.
2. **Synthetic disk I/O and persistence — PARTIAL PASS:** QD4 random I/O and the single-run sequential test met the stated synthetic targets; QD32 p95 did not. The same E3 disk and 4 GiB file survived five VM replacements and remounted. Repository occupancy and application ENOSPC behavior are still required.
3. **Cold-start baseline — PASS FOR STOCK IMAGE:** five fresh creates reached `VM running` in 13.8–19.6 seconds and guest-agent `Ready` in 29.8–40.1 seconds (median 35.7 seconds). This is not CoDev bridge readiness. The later end-to-end target remains 20 starts on the prepared image, at least 19 authenticated bridge successes, p50 at most 60 seconds and p95 at most 120 seconds, with create/boot/disk/tunnel/bridge timestamps separated.
4. **Connection architecture and isolation — DESIGN COMPLETE, PRODUCTION PROOF OPEN:** selected one named outbound Cloudflare Tunnel per active VM, loopback-only runtime, signed workspace/generation capability, Worker membership checks, egress-only IP, and deny-all inbound NSG. Canary probes and Quick Tunnel smoke passed. Production named tunnel, Worker path, token delivery, signed-capability rejection cases, and continuous NSG policy check remain.
5. **API and persisted data contract — DEFINED:** routes, idempotency, membership rules, generation/lease fencing, lifecycle states, operation fields, safe errors, and one-active-workspace owner claim are documented above. Implementation and race/failure tests remain future work.
6. **Monthly cost — ESTIMATE FITS, FULL BILL OPEN:** direct Azure workspace-resource estimates are $5.924 for one workspace/50 hours and $6.347 for two workspaces/35 shared hours at 5 GB egress and one million billable I/O units per managed disk, both pre-tax. Confirm actual workload meters and applicable tax before free-tier launch; if either cost exceeds $6.50, revise the limit or architecture.

## Readiness decision

**Phase 1 is ready to start as an isolated ARM image and workload validation phase, after the user's approval.** Subscription allocation succeeded, synthetic disk I/O and stock-image startup meet the initial thresholds at low queue depth, and the runtime contract and secure architecture are documented. Phase 1 must establish whether the 16 GiB disk can hold the actual workspace workload and measure native ARM software compatibility. This decision does not approve production rollout: production tunnel authorization, CoDev bridge readiness, measured per-owner Azure usage, tax, and the $6.50 launch cap remain open. No Phase 1 work was started in this task.

## Evidence and references

- Azure evidence (2026-10-03): `az account show`; `az vm list-skus --location westus2 --size Standard_D2ps_v6 --all`; the same query for Standard_D2pds_v6; `az vm list-usage --location westus2`; disposable `az vm create`/instance-view/delete; `az disk show`; guest `fio`, mount, and checksum checks; inbound socket probes; Quick Tunnel HTTP smoke; resource-group deletion verified with `az group exists` returning false. The canary resource group and temporary SSH key were removed. Subscription IDs and user identity are intentionally omitted.
- Project region and runtime baseline: [`infra/azure/deploy.sh`](../infra/azure/deploy.sh), [`infra/azure/README.md`](../infra/azure/README.md), and [`docs/OPERATIONS.md`](./OPERATIONS.md).
- [Dpsv6 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dpsv6-series) — Arm64 D2ps_v6, disk support and limits, and no ephemeral OS disk.
- [Dpdsv6 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dpdsv6-series) — D2pds_v6 local NVMe and ephemeral OS support.
- [Azure managed disk types and billing](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types) — E3 size/performance, transaction billing, and hourly disk proration.
- [Azure private subnet/default outbound access](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/default-outbound-access) — new VNets default to private subnets for APIs released after 2026-03-31; public IPs are one explicit outbound option.
- [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) — source for West US 2 rates. Direct queries checked the D2ps_v6 and D2pds_v6 Linux consumption meters, E3/E4 LRS disks, Standard IPv4 Public IP, Application Gateway Standard v2, and Internet data transfer out.
- [Azure NAT Gateway pricing](https://azure.microsoft.com/en-us/pricing/details/azure-nat-gateway/) and [Microsoft's published baseline rate answer](https://learn.microsoft.com/en-us/answers/questions/1190165/azure-nat-gateway-charges), plus [Application Gateway pricing](https://azure.microsoft.com/en-us/pricing/details/application-gateway/) — shared egress and gateway alternatives. NAT rates vary by offer; use a current quote if reconsidering it.
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) — available on all plans, outbound-only connectivity, no public ingress IP requirement.
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) — temporary public test URLs; used only for the harmless canary connectivity smoke test.
- [Cloudflare account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/) — 1,000 tunnels and routes per account.
- [Cloudflare tunnel firewall requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/) — outbound TCP/UDP 7844.
