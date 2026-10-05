# ARM free-tier Phase 6: UI, compute controls, and gated copy

Date: 2026-10-05. Implementation review; automated tests and live canaries
deliberately skipped at user request. Free rollout remains disabled
(`GEN2_FREE_ARM_ENABLED=false`). This change does not apply a production
migration, deploy, or change production configuration.

## Implemented UI and controls

1. **Dashboard compute summary (`/gen2`)**:
   - Fetches owner compute state via `getOwnerComputeSummary(userId)`.
   - Displays owned workspace count (up to 2), used/remaining monthly time (50h
     with 1 workspace, 35h with 2), and UTC reset date.
   - Suppresses the old subscription paywall callout for eligible free owners.

2. **Second free workspace quota acknowledgment**:
   - Creating a second free workspace requires explicit acknowledgment of the exact copy:
     > “Adding a second workspace gives you more storage and changes your monthly workspace time from 50 hours to 35 hours. Both workspaces share those 35 hours.”
   - Form requires checking the acknowledgment before enabling creation, sending
     `acknowledgeReducedQuota: true`.
   - If usage already exceeds 35 hours, explicitly warns that both workspaces remain
     saved on disk but cannot run until the next UTC reset date.

3. **Single active workspace conflict handling**:
   - Catches 409 `free_workspace_active` error during start and connection polling.
   - Identifies active workspace name and presents a confirmation modal
     (`WorkspaceSwitchDialog`) reusing `WorkspaceButton`.
   - Confirmed switch invokes `POST /api/gen2/compute` with `workspaceId`,
     `activeWorkspaceId`, and `idempotencyKey`.
   - Client polls source stop completion (`stoppingWorkspaceId`) before repeating
     the request to start the target workspace.
   - Prevents non-owner collaborators from switching the owner's active workspace.

4. **Quota, budget hold, and lifecycle explanations**:
   - Clear banners for quota exhaustion and operator budget holds.
   - Explicitly reassures users that saved files, Git branches, and disks are preserved.
   - ARM64 architecture notes explain compatibility expectations.
   - Startup steps display progress; recoverable errors support retry without
     discarding unsaved editor drafts.
   - Non-waking connection checks (`GET /activity`) ensure background health polling
     never wakes sleeping guests or artificially extends activity timestamps.

5. **Settings, billing, and pricing consistency**:
   - Billing panel (`/settings/personal/billing`) displays Free Tier (ARM Preview)
     usage stats, monthly allowance, and upgrade options for eligible accounts.
   - Paid plan allowances (1,000 minutes) and admin exemptions remain preserved.
   - Public pricing (`/pricing`) copy explains that ARM free tier availability is
     in early gated preview.

## Verification status

- `pnpm typecheck`: Clean across all packages (0 errors).
- `pnpm lint`: Clean across all packages (0 errors, 8 existing baseline warnings, 0 new warnings).
- **Deferred at user request**: Automated test suites, live guest canaries,
  production database migration application (`0069`), and feature flag activation.

## Remaining rollout requirements

1. Apply database migration `0069_gen2_free_owner_accounting.sql` with `pnpm db:migrate`
   and verify schema readiness with `pnpm db:check`.
2. Configure trusted monthly Azure cost telemetry ingestion to
   `POST /api/gen2/compute/reconcile` with the CRON secret.
3. Configure `GEN2_FREE_ARM_OWNER_IDS` allowlist for internal preview validation.
4. Run end-to-end acceptance tests and live ARM lifecycle canaries.
5. Enable `GEN2_FREE_ARM_ENABLED=true` on web deployment environments (Cloudflare
   Worker bindings and Vercel project environment variables).
