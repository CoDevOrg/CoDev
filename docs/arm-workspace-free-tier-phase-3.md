# ARM workspace Phase 3 — lifecycle control plane review

**Date:** 2026-10-04. **Status:** implementation present; release acceptance is
still gated. This phase adds database-backed Azure lifecycle operations to the
Cloudflare control plane. It does not route workspace tools to the ARM guest or
enable ARM workspaces for members.

## Decisions and contract

| Area                | Decision                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider selection  | Existing `gen2_workspaces` rows default to `firecracker`; `azure_arm` is an explicit per-row provider. Existing `sandbox_id` values and the Firecracker route remain intact.                                                                                                                                                                                                              |
| Operation identity  | `runtime_generation` identifies a VM incarnation and increments on start. `runtime_operation_id` fences a lifecycle operation. `runtime_cleanup_generation` durably records an older generation that must be cleaned before replacement or stop/delete can finish.                                                                                                                        |
| Locking and retries | A conditional Postgres update claims an operation using workspace status and generation. The row stores the idempotency key, operation kind, start time, lease expiry, resource state, and progress. A Cloudflare Workflow uses the operation ID, retries idempotently, and a scheduled reconcile recreates or rejoins expired jobs.                                                      |
| Start and readiness | Start returns after a durable job is queued; it does not keep the browser request open. `ready` is written only after Azure reports a running VM and the signed health response proves the expected workspace, generation, and disk UUID. A health read never wakes a VM.                                                                                                                 |
| Stop and delete     | Stop revokes the named tunnel route, requests Azure deallocation, observes `PowerState/deallocated`, then deletes the VM and generation-owned network. It retains the data disk. Delete first commits the product row to `deleting` (which blocks member access), then removes runtime resources and the disk, and finally removes the database row. Failed cleanup remains reconcilable. |
| Authentication      | Membership is checked in the Gen 2 domain layer before start, stop, delete, and health/activity calls. The guest health call uses the Phase 2 short-lived Ed25519 capability bound to host, workspace, generation, method, path, and body digest. Azure management and Cloudflare tunnel credentials are read only by the server runtime.                                                 |
| Transport           | Keep the Phase 2 per-VM outbound Cloudflare Tunnel. The VM has explicit outbound connectivity and a deny-all inbound NSG. Only the named tunnel's host maps to the loopback gateway.                                                                                                                                                                                                      |

The forward migration is `packages/db/drizzle/0067_gen2_runtime_lifecycle.sql`.
It adds provider/runtime enums and columns without rewriting old history; its
defaults leave existing rows on Firecracker. The shared shapes in
`packages/contracts/src/gen2.ts` define provider/status values, the optional
idempotency-key request, and the operation response.

| Endpoint                                        | Contract                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/gen2/workspaces/{id}/instance`       | Optional JSON `{ "idempotencyKey": "…" }`. Returns `{ accepted, operationId, workspace }`; HTTP 202 while queued/starting, HTTP 200 if already live and healthy. Without a body the server creates a key. |
| `DELETE /api/gen2/workspaces/{id}/instance`     | Owner-only stop. Returns the workspace; HTTP 202 while the persisted runtime state is `stopping`, otherwise HTTP 200.                                                                                     |
| `DELETE /api/gen2/workspaces/{id}`              | Owner-only asynchronous delete. Returns `{ success, workspaceId, accepted, operationId }`; the row remains inaccessible in `deleting` until cleanup completes.                                            |
| `GET /api/gen2/workspaces/{id}/activity`        | Member-authorized bounded live health check. Read-only; it does not wake the VM or count as activity.                                                                                                     |
| `POST /api/gen2/workspaces/{id}/activity`       | Member-authorized live health check followed by activity timestamp update only when connected.                                                                                                            |
| `GET /api/gen2/workspaces` and workspace detail | Expose provider, runtime status, and generation as the persisted progress contract. No Azure credentials or resource secrets are returned.                                                                |

Runtime states are `stopped`, `queued`, `provisioning`, `booting`,
`attaching_disk`, `starting_tunnel`, `checking_readiness`, `ready`, `stopping`,
and `failed`. Existing workspace states remain the UI-level lifecycle. Errors
are stored as safe user-facing messages; provider logs correlate workspace,
operation, generation, and internal error code without logging credentials.

## Validation evidence

- Full `pnpm typecheck` and `pnpm test` pass. The test run reports 992 passing
  tests across the infrastructure, CLI, packages, and web app.
- Full `pnpm lint` exits successfully with 8 existing warnings (file-length and
  unrelated existing web warnings); the new runtime provider and operation
  modules report no lint warnings.
- New regressions verify stale generations are retained for cleanup, competing
  starts join the winning operation, tunnel cleanup failure still deallocates
  and removes the VM, and network deletion follows VM deletion. The complete
  web suite passes 869 tests, including existing compute reconciliation,
  startup-client, instance API, and Firecracker lifecycle tests.
- Database schema tests pass for the new provider/status enums and cleanup
  generation column. `pnpm db:generate` reports no additional migration is
  needed; migration `0067` has not been applied.
- The Phase 2 isolated infrastructure suite previously passed 41 tests and the
  lifecycle canary `37230952626`; see the [Phase 2 review](arm-workspace-free-tier-phase-2.md).
  Those tests validate the isolated CLI/Blob-lease controller, not this new
  Worker adapter.
- No migration was applied, no Cloudflare deployment was run, and no Azure or
  Cloudflare resource was changed in this phase.

## Open risks and release gates

1. **Validate the database rollout.** Checks and migration generation pass, but
   the forward migration is not applied. Apply it only after `pnpm db:check` and
   a reviewed rollout plan.
2. **Prove Worker lifecycle recovery.** Add/complete adapter-level tests for
   stop/delete authorization, missing disks, lost/restarted Workflow execution,
   stale completions, partial teardown, and retry after an expired operation
   lease. The existing 41 infrastructure tests are useful evidence but do not
   exercise the Postgres/Cloudflare Workflow implementation.
3. **Review the lock design.** Product lifecycle control uses conditional
   Postgres claims plus durable Cloudflare Workflows. Phase 2's isolated
   controller uses Azure Blob leases. This Worker adaptation preserves the
   fencing and deterministic resource ownership but is a separate execution
   path; concurrency and crash-recovery evidence above is required before
   release.
4. **Provision and audit runtime secrets/RBAC.** The Worker configuration
   declares Azure client credentials, the exact ARM image version, SSH public
   key, Ed25519 key pair, and Cloudflare Tunnel/DNS token. This work did not set
   them. Confirm the deployed service identity is narrowly scoped to its
   workspace resource group and the Cloudflare token is scoped to the account
   and `trycodev.com` zone. Rotate the Azure client secret under the selected
   secret-management policy.
5. **Complete Phase 4 before member use.** Files, Git, terminal, agent, Superset,
   uploads, and collaboration still use the Firecracker guest adapters. A
   workspace marked ARM-ready is not yet an end-to-end usable ARM workspace.
6. **Keep cost and latency gates open.** The two Phase 2 start observations
   were 218 seconds and 348 seconds, both above the Phase 0 prepared-image
   target of p95 at most 120 seconds; two observations do not establish p95.
   Posted Azure billed meters, full-allowance usage, tax, egress, and I/O remain
   unmeasured against the $6.50 per-owner monthly cap.

## Acceptance criteria

| Criterion                                                                                       | Current result                                                                         |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Forward migration preserves existing Firecracker rows and sandbox IDs                           | **Implemented; database validation pending**                                           |
| Start is asynchronous, generation-fenced, and idempotent; readiness requires signed live health | **Implemented; Worker recovery tests pending**                                         |
| Membership/owner checks precede every operation and health request                              | **Implemented in domain/routes; dedicated ARM authorization tests pending**            |
| Stop/delete preserve the saved disk correctly and remove owned resources after deallocation     | **Implemented; targeted shutdown regressions pass; full failure/retry matrix pending** |
| Firecracker behavior remains unchanged                                                          | **Existing Firecracker path retained; full regression suite passes**                   |
| All required runtime secrets/RBAC exist in the deployed Cloudflare Worker                       | **Not configured or verified**                                                         |
| ARM editor/Git/terminal/agent/collaboration path works end to end                               | **Phase 4 outstanding**                                                                |
| Startup and direct Azure cost gates pass                                                        | **Not met / not measured**                                                             |

**Phase 3 is not accepted for production enablement.** Continue the adapter
recovery and authorization tests, complete the repository checks, then start
Phase 4 against an isolated deployment. Do not enable ARM workspaces for
members until Phase 4, the latency sample, and measured $6.50 cost gates pass.
