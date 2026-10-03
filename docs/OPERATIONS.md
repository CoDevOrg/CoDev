# CoDev Operations

## Normal signals

- `GET /api/health` is cheap process liveness.
- `GET /api/ready` checks PostgreSQL, Redis, and the runtime. A deallocated
  Firecracker host is reported as `sleeping` and is healthy.
- Vercel logs are structured JSON with a release and request ID.
- Azure Monitor collects the host's orchestrator log and VM availability; see
  the Log Analytics workspace in `infra/azure/main.bicep`.
- Runtime spend is Azure Cost Management, surfaced in the admin dashboard
  (`apps/web/lib/admin/azure-cost.ts`).
- Workspace audit events retain for 90 days.

## Domain email

`trycodev.com` is registered with Vercel. Product mail is sent with Resend from
`noreply@trycodev.com`. Operator mail (`yousef@trycodev.com` and a catch-all) is
free ImprovMX forwarding, not a hosted mailbox. Full DNS, env, and setup notes
are in [EMAIL.md](./EMAIL.md).

## Deployment

1. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`, `pnpm rust:check`, and `pnpm test:e2e`.
2. Apply the Drizzle migration with `pnpm db:migrate`.
3. A push to `main` that touches `services/`, `infra/azure/`, or
   `infra/runtime/scripts/` runs `infra/runtime/deploy.sh` through the **Deploy runtime**
   workflow — anyone's push ships the runtime, not just a maintainer's laptop.
   Watch that run rather than deploying by hand, and let the host return to
   `stopped` afterwards. `infra/runtime/deploy.sh` stays runnable locally, and the
   workflow can be started by hand from the Actions tab.
4. Push. On `main`, the **CI** workflow runs its checks, builds the
   Cloudflare Worker on a GitHub-hosted runner, and deploys it with `cf deploy`.
   The Worker serves `trycodev.com`; use the Cloudflare Dashboard or CLI to
   verify the active deployment. The Cloudflare Workers Builds trigger should
   stay disabled after this path is enabled, so one system owns production
   deployments.
5. The **Deploy web** workflow
   ([`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml))
   continues to deploy the Vercel project on pushes. Vercel's Git integration
   is off (`git.deploymentEnabled: false`), so this workflow remains its
   deployment path.
6. Run `scripts/verify-deployment.sh <preview-url>` against the Vercel preview
   the branch run printed when validating a preview.
7. Re-run the verification script against the production URL and scan the
   Cloudflare and Vercel logs.

## Cloudflare deploy credentials

The production deploy job in **CI** requires:

- `CLOUDFLARE_API_TOKEN` — a GitHub repository secret with Cloudflare Workers
  deploy access, scoped to the CoDev account and the `trycodev.com` zone.
- `CLOUDFLARE_ACCOUNT_ID` — a GitHub repository variable containing the
  Cloudflare account ID.

The workflow reuses the repository's locked `cf` CLI and its existing
`vite build` / `cf deploy --prebuilt` commands. Worker secrets remain stored in
Cloudflare; the deploy does not copy application credentials into GitHub.

## Vercel deploy credentials

The **Deploy web** workflow deploys the Vercel project with the Vercel CLI, so it
needs one repository secret and refuses to run with a clear error until it is
set:

- `VERCEL_TOKEN` — a Vercel access token scoped to the team that owns the
  `codev` project (Vercel → Account Settings → Tokens). The team and project
  IDs are not secret and are set as `env:` in the workflow. Rotate the token
  before it expires; the workflow's "Check token" step names the fix in its
  failure message.

Nothing else is required — a token push deploys regardless of who pushed,
which is the point of not using Vercel's Git integration.

## Runtime deploy credentials

The **Deploy runtime (Azure)** workflow authenticates to Azure over GitHub's
OIDC provider, so no Azure client secret lives in the repository: an Entra app
registration trusts GitHub's token through a federated credential matched on
the token's subject. The required repository variables and the exact federated
credential subjects are documented in
[`infra/azure/README.md`](../infra/azure/README.md).

CoDevOrg emits **immutable-identifier** subject claims, so the federated
credential matches `repo:CoDevOrg@320302482/CoDev@1315384847:...` (org ID
`320302482`, repo ID `1315384847`), not the `repo:CoDevOrg/CoDev:ref:...`
form. A rename is therefore safe; recreating the org or repo is not, and means
updating those subjects.

Human/local runs of `az` use the operator's own login. There is no CoDev AWS
runtime any more: the account holds nothing for CoDev beyond the `codev_user`
IAM user, kept so the profile still resolves, and the Bedrock model-provider
feature, which uses a member's own AWS account rather than ours.

## Lifecycle recovery

GitHub Actions invokes `/api/cron/lifecycle` every 45 minutes with
`Authorization: Bearer $CRON_SECRET`. The repository secret must be named
`CRON_SECRET`. A manual retry is safe:

```sh
curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://codev-xi.vercel.app/api/cron/lifecycle
```

Run it twice when validating idempotency. The second response should report
zero newly cleaned workspaces.

For real Linux/KVM lifecycle validation, run the host-local smoke test after
deploying a Rust or Firecracker change:

```sh
sudo /opt/codev-verify-lifecycle.sh
```

It creates a Superset worktree and an untracked file, stops the durable guest
without explicitly snapshotting, reopens it, and verifies both the worktree
list and exact file contents. It requires zero other active guests and cleans
up its own workspace and snapshots.

On an isolated test host, set `CODEV_VERIFY_SERVICE_RESTART=1` to also restart
`codev-orchestrator.service` after writing newer data following the first
restore. This verifies that a service restart preserves the latest work rather
than reverting to an older checkpoint. Supply `CODEV_DIRECT_SECRET` when the
local endpoint requires authentication. This test needs Linux/KVM and the
Superset host artifact; filesystem recovery unit tests do not boot a microVM.

Runtime rollout must wait for active guests on the old release to hibernate
before restarting it: the old binary does not checkpoint on SIGTERM. The new
service uses `KillMode=mixed` and a 180-second stop timeout so the orchestrator
can flush and save guests before systemd kills child processes. New startup
never bulk-deletes live guest directories. Legacy interrupted disks without
recovery metadata produce an explicit recovery error and remain untouched.

## Incident checklist

1. Capture the Vercel deployment SHA, request ID, workspace ID, UTC time, and
   the Azure Monitor alert.
2. Stop new mutations by disabling the affected deployment or revoking the
   relevant capability.
3. For isolation concerns, deallocate the `codev-runtime-host` VM
   (`az vm deallocate`).
4. Check Vercel structured logs, the host's orchestrator log in Azure Monitor,
   and workspace audit events using the same request/workspace ID.
5. Revoke GitHub/OpenAI credentials if exposure is suspected.
6. Reconcile lifecycle state, confirm the host returns to `deallocated`, and
   verify no running turns or active claims remain.
7. Roll back Vercel to the last verified deployment. Runtime releases are
   immutable blob prefixes; re-tag the previous `ReleaseVersion` and restart
   the host if needed.

Never delete evidence or force-push a publication branch during an incident.

## Superset chat storage readiness

Run `pnpm db:check` against the same database used by the web app. `pnpm dev`
checks this before starting; the web deployment workflow checks the pulled Vercel
environment before publishing. If it fails, run `pnpm db:migrate` with the target
database configured, then repeat the check. Do not assume the latest migration
ledger timestamp proves all older objects exist: a merged history can skip an
older migration. Migration `0064_repair_superset_run_storage` safely repairs the
Superset run tables even when later migrations were already recorded.

Database query failures return HTTP 503 with a safe message and `Retry-After`.
Server logs record only the database error code, never the SQL or parameters.

The compute allowance requires migration `0065_burly_star_brand` before the
web release. Production schedules `/api/gen2/compute/reconcile` every minute
with `CRON_SECRET`; confirm the Vercel project supports one-minute cron jobs
and monitor its runs. The route measures running Gen 2 guest intervals and
hibernates an owner's active workspaces once their combined UTC-month usage
reaches 1,000 minutes. A missed scheduled run delays enforcement, so alert on
repeated failures.
A failed chat start restores the draft and attachments and removes the optimistic
message so the user can retry. Transient outages are not automatically retried
because a start request may already have reached the server.

Superset guest rollout compatibility: the web client sends both the neutral
`launchProfile` and its legacy `codexAuthCacheJson` field for Codex until older
host-service images have been replaced. Do not remove the legacy field before
verifying a real agent start on retained guests. A runtime validation mismatch
returns an actionable 503 instead of blaming the user's prompt. Older guests
also need the root-owned `/var/lib/codev-agent-profiles` parent set to 0711;
individual agent directories stay 0700 and credential files stay 0600. Both guest
image builders set this parent mode inside the host-service's final `ExecStart`
wrapper. `ExecStartPre` alone is insufficient: systemd reapplies
`StateDirectoryMode=0700` for the next command. Keep the host state directory
private and change only the agent-profile parent. The poll bridge includes both
plain `data` and `dataBase64` for rolling compatibility; web clients unwrap the
orchestrator's `result` envelope before validating poll and recovery responses.
