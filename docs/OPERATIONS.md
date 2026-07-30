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

## Deployment

1. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`, `pnpm rust:check`, and `pnpm test:e2e`.
2. Apply the Drizzle migration with `pnpm db:migrate`.
3. If Rust or AWS changed, run `infra/aws/deploy.sh`, record its release, and
   allow the host to return to `stopped`.
4. Deploy a Vercel preview from that exact source state.
5. Run `scripts/verify-deployment.sh <preview-url>`.
6. Promote the verified preview. Vercel rebuilds the same source for the
   production environment so production-scoped credentials are applied.
7. Re-run the verification script and scan Vercel error logs.

## Closed-beta pilot operations

The `/pilot` console is available only to GitHub logins listed in the
server-only `PILOT_ADMIN_GITHUB_LOGINS` environment variable. Keep the
development, preview, and production allowlists independently scoped. Removing
a login takes effect on its next request and does not require a database role
change.

Use one pilot session per workspace validation run. Complete the ten
checkpoints in order, triage any resulting feedback, and only mark the session
complete after teardown is confirmed. A blocked session must include a blocker
category. See [PILOT_OPERATIONS.md](./PILOT_OPERATIONS.md) for metric
definitions and the privacy boundary.

## Lifecycle recovery

Vercel invokes `/api/cron/lifecycle` daily with `Authorization: Bearer
$CRON_SECRET`. A manual retry is safe:

```sh
curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://codev-xi.vercel.app/api/cron/lifecycle
```

Run it twice when validating idempotency. The second response should report
zero newly cleaned workspaces.

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
