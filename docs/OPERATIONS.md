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
