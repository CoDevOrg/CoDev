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
4. Deploy a Vercel preview from that exact source state.
5. Run `scripts/verify-deployment.sh <preview-url>`.
6. Promote the verified preview. Vercel rebuilds the same source for the
   production environment so production-scoped credentials are applied.
7. Re-run the verification script and scan Vercel error logs.

## Runtime deploy credentials

The **Deploy runtime** workflow assumes an AWS role over GitHub's OIDC
provider, so no long-lived AWS keys live in the repository. It needs one
repository variable, and refuses to run with a clear error until it is set:

- `AWS_DEPLOY_ROLE_ARN` — the role GitHub assumes. Its trust policy must accept
  `token.actions.githubusercontent.com` for `repo:CoDevOrg/CoDev:ref:refs/heads/main`,
  and it needs the permissions `deploy.sh` uses: CloudFormation on the
  `codev-runtime-artifacts` and `codev-runtime` stacks, S3 on the release
  bucket, IAM to maintain the two `codev-vercel-*` roles, EC2/SSM for the host,
  and `sts:GetCallerIdentity`.
- `AWS_REGION` — optional, defaults to `us-east-2`.

If the account has no GitHub OIDC provider yet, add one for
`https://token.actions.githubusercontent.com` with the `sts.amazonaws.com`
audience before creating the role.

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
