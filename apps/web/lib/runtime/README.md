# Runtime

This module owns the communication and integration with external execution environments (orchestrator, Azure hosts, cloud IDEs). It handles sandbox readiness, file syncing, terminal execution, and environment health checks.

**Does not own:** The UI components for the terminal or code editor, or general Azure infrastructure definitions under `infra/azure`.

**Key files:**

- `orchestrator.ts`, `orchestrator-*.ts`: Orchestrator API interactions (terminals, files, health).
- `host.ts`, `azure-host.ts`: Logic for interacting with runtime host providers.
- `ide.ts`: IDE state and connection definitions.
- `arm-workspace-provider.ts`, `arm-workspace-workflow.ts`: Azure ARM workspace provisioning, health, and durable lifecycle execution.

- `workspace-runtime-target.ts`, `arm-workspace-request.ts`: Resolve workspace
  provider/generation for each guest call, sign its exact method/path/body, and
  preserve the host API response envelopes. Domain callers must authorize
  membership before using these clients; the adapter does not authorize users.
- `arm-workspace-activity.ts`, `arm-workspace-member-activity.ts`: Observe live
  guest agent work and record successful member mutations without counting
  reads, connection checks, or polls as input.

- `arm-workspace-config.ts`: Requires dedicated ARM Azure credentials and resource
  group; never reuses Firecracker credentials. The pinned gallery image may live
  in another ARM resource group within the configured subscription.

The opt-in `arm-workspace-staging-canary.test.ts` uses
`CODEV_ARM_CANARY_CREDENTIAL_DIR` for operator credentials outside the repository.
It creates only disposable workspaces in `codev-arm-workspace-staging`, records
resource IDs for recovery, and removes its compute, routes, and test disk.
