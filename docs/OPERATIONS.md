# CoDev Operations

## Normal signals

- `GET /api/health` is cheap process liveness.
- `GET /api/ready` checks PostgreSQL, Redis, and the AWS runtime. A stopped
  Firecracker host is reported as `sleeping` and is healthy.
- Vercel logs are structured JSON with a release and request ID.
- The AWS CloudWatch dashboard contains API count/5xx, Lambda errors/duration,
  and EC2 status checks. Logs retain for 14 days.
- The `codev-runtime-monthly` budget tracks tagged CoDev spend. When an alert
  email is configured, forecasted spend warns at 80% and actual spend warns at
  100%.
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
3. A push to `main` that touches `packages/ide/`, `services/`, or `infra/aws/`
   now runs `infra/aws/deploy.sh` itself, through the **Deploy runtime**
   workflow — anyone's push ships the runtime, not just a maintainer's laptop.
   Watch that run rather than deploying by hand, and let the host return to
   `stopped` afterwards. `infra/aws/deploy.sh` stays runnable locally, and the
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

The **Deploy runtime** workflow assumes an AWS role over GitHub's OIDC
provider, so no long-lived AWS keys live in the repository. It needs one
repository variable, and refuses to run with a clear error until it is set:

- `AWS_DEPLOY_ROLE_ARN` — the role GitHub assumes. Currently
  `arn:aws:iam::014576992564:role/codev-github-actions-runtime-deploy`
  (account `014576992564`, region `us-east-2`), with `AdministratorAccess`
  because `deploy.sh` drives CloudFormation with `CAPABILITY_NAMED_IAM` and
  touches IAM, KMS, EC2/spot, S3, Budgets and SSM — the surface documented
  here (CloudFormation on the `codev-runtime-artifacts` and `codev-runtime`
  stacks, S3 on the release bucket, IAM for the `codev-vercel-*` roles,
  EC2/SSM for the host, `sts:GetCallerIdentity`) is what a tighter policy
  would need to cover.
- `AWS_REGION` — optional, defaults to `us-east-2`.

The account's GitHub OIDC provider is
`arn:aws:iam::014576992564:oidc-provider/token.actions.githubusercontent.com`
(audience `sts.amazonaws.com`). CoDevOrg emits **immutable-identifier**
subject claims, so the role's trust condition matches
`repo:CoDevOrg@320302482/CoDev@1315384847:*` (org ID `320302482`, repo ID
`1315384847`) — not the `repo:CoDevOrg/CoDev:ref:refs/heads/main` form. The
`deploy` job also sets `environment: production`, which makes the run
context `:environment:production`; narrow the trailing `:*` to that if you
want the trust pinned to the environment. Recreating the role from scratch
means: create the OIDC provider for
`https://token.actions.githubusercontent.com` with the `sts.amazonaws.com`
audience, then create the role with that trust.

Human/local runs of `deploy.sh` and the `aws` CLI use the `codev_user` IAM
user (its own `codev` CLI profile), not the shared `topnet_user` from an
unrelated project.

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
verifies that the orchestrator reports zero active sandboxes. Set
`CODEV_EC2_INSTANCE_ID` to have the script also poll the EC2 state until it is
`stopped`; host power-off is intentionally asynchronous.

Run the authenticated launch preflight from Settings before every
design-partner session. With zero active workspaces, any host state other than
`stopped` or `stopping` requires lifecycle reconciliation and an explicit EC2
stop.

If PostgreSQL says a runtime is ready while EC2 is stopped, the reconciler
interrupts active work, expires claims, marks physical worktrees discarded,
and records a `lifecycle.cleaned` event. If unpublished integration work was
lost, the workspace is marked failed rather than silently claiming recovery.

## Incident checklist

1. Capture the Vercel deployment SHA, request ID, workspace ID, UTC time, and
   CloudWatch alarm.
2. Stop new mutations by disabling the affected deployment or revoking the
   relevant capability.
3. For isolation concerns, stop the `codev-firecracker-host` EC2 instance.
4. Check Vercel structured logs, API Gateway access logs, Lambda logs, and
   workspace audit events using the same request/workspace ID.
5. Revoke GitHub/OpenAI credentials if exposure is suspected.
6. Reconcile lifecycle state, confirm EC2 returns to `stopped`, and verify no
   running turns or active claims remain.
7. Roll back Vercel to the last verified deployment. AWS releases are immutable
   S3 prefixes; redeploy the previous `ReleaseVersion` if needed.

Never delete evidence or force-push a publication branch during an incident.
