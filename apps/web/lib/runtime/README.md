# Runtime

This module owns the communication and integration with external execution environments (orchestrator, Azure hosts, cloud IDEs). It handles sandbox readiness, file syncing, terminal execution, and environment health checks.

**Does not own:** The UI components for the terminal or code editor, or the underlying cloud infrastructure provisioning itself.

**Key files:**

- `orchestrator.ts`, `orchestrator-*.ts`: Orchestrator API interactions (terminals, files, health).
- `host.ts`, `azure-host.ts`: Logic for interacting with runtime host providers.
- `ide.ts`: IDE state and connection definitions.
