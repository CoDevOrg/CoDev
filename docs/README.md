# CoDev docs index

Repository guidance lives in [`AGENTS.md`](../AGENTS.md). For the product overview,
see [`README.md`](../README.md) and [`PRD.md`](../PRD.md).

**Current** documents are kept in step with the code. **Design** documents record
intent that may have drifted; confirm details against the code.

## Operating the product

| Document                                                                               | Status  | Covers                                                                  |
| -------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| [OPERATIONS.md](./OPERATIONS.md)                                                       | Current | Health signals, crons, Azure runtime deploy credentials, incident steps |
| [BILLING.md](./BILLING.md)                                                             | Current | Stripe Individual plan: paywall rules, webhook flow, env, provisioning  |
| [EMAIL.md](./EMAIL.md)                                                                 | Current | `trycodev.com` email: Resend sending, ImprovMX receiving                |
| [security/openai-hosted-codex-approval.md](./security/openai-hosted-codex-approval.md) | Current | Approval record for the hosted Codex CLI remote-auth pattern            |

## Architecture and integration

| Document                                                             | Status  | Covers                                                                   |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| [gen2-workspace.md](./gen2-workspace.md)                             | Current | Gen 2 workspace: Firecracker instance, shareable membership, Codex chats |
| [SUPERSET_WORKSPACE_OWNERSHIP.md](./SUPERSET_WORKSPACE_OWNERSHIP.md) | Design  | Phase 1 ownership contract for a first-party Superset-powered workspace  |
| [SUPERSET_AGENT_SESSION_PLAN.md](./SUPERSET_AGENT_SESSION_PLAN.md)   | Design  | Superset agent sessions, CoDev provider ownership, and rollout gates     |
| [GIT_PROXY.md](./GIT_PROXY.md)                                       | Design  | Git over the control plane without credentials in the guest (unbuilt)    |

## UI implementation

| Document                                                             | Status  | Covers                                                             |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [design/workspace-controls.md](./design/workspace-controls.md)       | Current | Workspace buttons, navigation states, and contributor review rules |
| [design/superset-workspace-ui.md](./design/superset-workspace-ui.md) | Design  | Gen 2 Superset workspace layout, tokens, and visual contract       |

## Product

| Document                                                           | Status | Covers                                                    |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------- |
| [product/ENTERPRISE_FEATURES.md](./product/ENTERPRISE_FEATURES.md) | Design | Long-range product vision; not a list of shipped features |

Add new documents to the matching folder and update this index. Remove index
entries when documents are deleted.
