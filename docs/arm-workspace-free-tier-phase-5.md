# ARM free-tier Phase 5: entitlements and accounting

Date: 2026-10-05. Implementation review; tests and live canaries deliberately
skipped at the user's request. Free rollout remains disabled. This change does
not apply a production migration, deploy, or enable free accounts.

## Policy and implementation

- Eligible free owners receive 50 UTC-month hours with one owned workspace,
  or 35 total hours with two. Owned slots include workspaces still being deleted.
  Invited membership does not consume slots; every member consumes the current
  owner's allowance. Paid owners retain 1,000 minutes; admins remain unlimited.
- Second creation requires `acknowledgeReducedQuota: true`, after showing:
  “Adding a second workspace gives you more storage and changes your monthly
  workspace time from 50 hours to 35 hours. Both workspaces share those 35 hours.”
  Creation remains allowed after 35 hours; compute is blocked. Deletion restores
  the higher limit without erasing used time. Ownership transfers split intervals
  and retain each owner's history. Transfers during provisioning are refused.
- Owner row locks serialize create/delete/transfer and active reservations.
  The claim table has one row per owner. Every free compute entry checks the
  reservation, quota, and budget. A conflict identifies the other workspace;
  ordinary opens never evict it.
- `POST /api/gen2/compute` requires the owner to explicitly name both target and
  source (`workspaceId`, `activeWorkspaceId`, `idempotencyKey`). It queues the
  source stop and returns `stoppingWorkspaceId`. Poll its lifecycle until stopped,
  then repeat the request to start the target. A provisioning source must finish
  startup first. Collaborators cannot switch the owner's active workspace.
- ARM allocated boot minutes count. Azure power-state inspection never wakes a
  guest. Running/starting/stopping/stopped/deallocating allocations retain their
  interval; confirmed missing/deallocated resources close it at the last observed
  allocated timestamp. This bounds stale-ready phantom time to observation
  precision. Allocated stopped VMs trigger release. Stop completion closes the
  interval and releases the claim; failed cleanup retains the reservation.
- Quota and budget are checked before startup and again after boot/before ready.
  The existing per-minute reconciler stops exhausted active owners. A startup
  already in progress finishes or fails its bounded lifecycle before cleanup;
  it is not immediately cancelled by the quota reconciler.

## Budget telemetry and operational breaker

`POST /api/gen2/compute/reconcile` accepts trusted complete cumulative monthly
cost snapshots using `Authorization: Bearer <CRON_SECRET>`. Required fields:
`currency: "USD"`, `complete: true`, owner UUID, UTC month-start `month`,
`observedAt`, and nonnegative integer `computeCents`, `storageCents`,
`networkCents`, `operationsCents`, `otherCents`. Optional `blocked: true` applies
an operator hold. Newer observations replace older ones; repeated/stale reports
are ignored. Include OS/data disks, retained resources/snapshots, transaction
meters, networking, and applicable tax in those categories.

The compute summary exposes budget spend, limit, observation time, and blocked
state. Missing or older-than-24-hour current-month telemetry blocks free compute,
as does an operator hold or total spend of at least 650 cents. Saved disks are
preserved. A newer complete report below the limit can clear an operator hold.

This route is an ingestion boundary, not a deployed Azure cost collector. A
trusted collector and resource-to-owner attribution must be configured before
rollout. The breaker reacts to reported spend and can overshoot between reports;
it does not guarantee an Azure bill of $6.50. Persistent disks still cost money
while compute is paused. The roadmap's measured full-allowance cost gate remains
required before release.

## Migration and rollout

Migration `0069_gen2_free_owner_accounting.sql` adds owner reservations, monthly
budget snapshots, and `last_observed_allocated_at` to the retained usage ledger.
It does not rewrite applied history or remove workspace/session records.
`pnpm db:check` now probes the new objects explicitly.

1. Review and apply `0069` to the target database with `pnpm db:migrate`; then
   run `pnpm db:check` before app start/deployment.
2. Deploy with `GEN2_FREE_ARM_ENABLED=false` (default). Cloudflare uses build-time
   text bindings; Vercel uses project environment variables.
3. Configure complete monthly cost reporting and reconcile retained resources.
4. Complete Phase 6 controls/copy and deferred Phase 5 verification, then use
   `GEN2_FREE_ARM_OWNER_IDS` for an internal allowlist before wider enablement.

Rollback: disable the flag on both web platforms and redeploy. New free creation
and starts are blocked; reconciliation stops existing free sessions while
preserving saved disks. Keep the additive migration and usage/budget history.
Revert application code only after active free operations are safely drained.
Do not drop usage tables or discard disks to roll back entitlements.

## Verification status

Typecheck and lint are the implementation checks for this change. Existing
lint warnings are baseline warnings. Automated tests, quota race/rollover
acceptance, database application, Azure cost collection, and live lifecycle
canaries were not run. Phase 5's test exit gate is deferred, not passed.
Phase 6 (free-tier UI and copy) is the next implementation phase.
