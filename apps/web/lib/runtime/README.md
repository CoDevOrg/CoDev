# Runtime

This module owns the communication and integration with external execution environments (orchestrator, Azure hosts, cloud IDEs). It handles sandbox readiness, file syncing, terminal execution, and environment health checks.

**Does not own:** The UI components for the terminal or code editor, or general Azure infrastructure definitions under `infra/azure`.

**Key files:**

- `orchestrator.ts`, `orchestrator-*.ts`: Orchestrator API interactions (terminals, files, health).
- `host.ts`, `azure-host.ts`: Logic for interacting with runtime host providers.
- `ide.ts`: IDE state and connection definitions.
- `arm-workspace-provider.ts`, `arm-workspace-workflow.ts`: Azure ARM workspace provisioning, health, and durable lifecycle execution.
- `arm-workflow-io.ts`: Bounded workflow I/O checkpoints and continuation replay;
  parallel branches use independent step numbering with a shared request budget
  and journal. Both settle before handoff so replay never loses a mutation.
  Cloudflare persists every checkpoint output and copies it into continuation
  parameters, so checkpoints must never return secrets. Fetch tunnel tokens
  inside the Azure request step that delivers them as protected settings.
  Normal web requests and staging canaries execute directly without a workflow.
- `readiness.ts`: Web service database and realtime readiness. Guest readiness
  belongs to each workspace lifecycle; the retired Firecracker host is not a
  dependency of web service readiness.

- `workspace-runtime-target.ts`, `arm-workspace-request.ts`: Resolve workspace
  provider/generation for each guest call, sign its exact method/path/body, and
  preserve the host API response envelopes. Domain callers must authorize
  membership before using these clients; the adapter does not authorize users.
  Runtime routing is imported statically so its database lookup shares the
  caller’s request or operation context. `orchestrator-error.ts` owns the shared
  transport error without a routing import cycle. Durable agent polls pass their
  transaction through the transport to resolve the route on the live connection.
- `arm-workspace-activity.ts`, `arm-workspace-member-activity.ts`: Observe live
  guest agent work and record successful member mutations without counting
  reads, connection checks, or polls as input. Read-only guest commands that
  go through `/v1/pty/exec` (preview port listing) pass `recordActivity: false`
  through `executeInSandbox`, `orchestratorRequest`, and `armWorkspaceRequest`.
- `arm-control-plane-token.ts`: The one Ed25519 signer for control-plane tokens
  guests verify. Callers bind each token to one guest service with `aud` and
  `scope`: gateway capabilities (`capabilityToken`) and preview sessions.
- `arm-workspace-preview-route.ts`, `arm-workspace-preview-token.ts`,
  `arm-workspace-preview-sweep.ts`: Browser preview hosts
  (`p<port>-<hash>-g<generation>.<zone>`), the tunnel's wildcard ingress rule
  and per-host CNAMEs (added on demand from the web app, never in the
  lifecycle Workflow), preview session tokens, and the reconcile cron's
  bounded sweep of records whose generation is no longer ready. The route
  calls back before spending Cloudflare budget and before routing the zone to
  a guest; membership, the zone setting, rate limits, and the guest proxy
  check belong to `lib/gen2` (see docs/WEB_HOSTING.md).

- `arm-workspace-config.ts`: Requires dedicated ARM Azure credentials and resource
  group; never reuses Firecracker credentials. The pinned gallery image may live
  in another ARM resource group within the configured subscription.

The opt-in `arm-workspace-staging-canary.test.ts` uses
`CODEV_ARM_CANARY_CREDENTIAL_DIR` for operator credentials outside the repository.
It creates only disposable workspaces in `codev-arm-workspace-staging`, records
resource IDs for recovery, and removes its compute, routes, and test disk.

`ARM_WORKSPACE_BOOT_ENABLED` selects the baked guest boot protocol only after
its pinned image has passed a live canary. Identity and connector credentials
are delivered through a secure deployment parameter and protected extension
settings; local disk setup replaces sequential Run Commands. Disable this flag
and restore the previous image pin together to roll back new VM starts.

Azure Container Apps uses `azure.ts` with its user-assigned managed identity for
Key Vault credential unwrapping. ARM VM lifecycle credentials remain separate.
