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
3. A push to `main` that touches `packages/ide/`, `services/`, or `infra/runtime/`
   now runs `infra/runtime/deploy.sh` itself, through the **Deploy runtime**
   workflow — anyone's push ships the runtime, not just a maintainer's laptop.
   Watch that run rather than deploying by hand, and let the host return to
   `stopped` afterwards. `infra/runtime/deploy.sh` stays runnable locally, and the
   workflow can be started by hand from the Actions tab.
4. Push. The **Deploy web** workflow
   ([`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml))
   deploys `apps/web` on every push — a branch gets a Vercel preview, `main`
   gets built and promoted to production with `--prod`. Vercel's own Git
   integration is off (`git.deploymentEnabled: false`), so this workflow is
   the only path; watch its run rather than deploying by hand. It can also be
   started from the Actions tab, and `vercel` runs locally against the linked
   project.
5. Run `scripts/verify-deployment.sh <preview-url>` against the preview the
   branch run printed.
6. Merge to `main`. The run on `main` rebuilds the same source for the
   production environment so production-scoped credentials are applied, then
   promotes it.
7. Re-run the verification script and scan Vercel error logs.

## Web deploy credentials

The **Deploy web** workflow deploys with the Vercel CLI, so it needs one
repository secret and refuses to run with a clear error until it is set:

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

It creates a dirty integration file, an agent-worktree file, and a PTY session;
snapshots and destroys the VM; restores it from the Firecracker snapshot; checks
all three state types; measures restore latency against the 500 ms target; and
verifies that the orchestrator reports zero active sandboxes. Host power-off is
intentionally asynchronous, and on Azure it is a _deallocate_ rather than a
power-off — a VM stopped from inside the guest stays allocated and keeps
billing.

Run the authenticated launch preflight from Settings before every
design-partner session. With zero active workspaces, any host state other than
`stopped` or `stopping` requires lifecycle reconciliation and an explicit
deallocate.

If PostgreSQL says a runtime is ready while the host is deallocated, the
reconciler
interrupts active work, expires claims, marks physical worktrees discarded,
and records a `lifecycle.cleaned` event. If unpublished integration work was
lost, the workspace is marked failed rather than silently claiming recovery.

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
