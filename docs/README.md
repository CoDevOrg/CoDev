# CoDev docs index

Repository guidance lives in [`AGENTS.md`](../AGENTS.md). For the product overview,
see [`README.md`](../README.md) and [`PRD.md`](../PRD.md).

**Current** documents are kept in step with the code. **Design** documents record
intent that may have drifted; confirm details against the code.

## Operating the product

| Document                                                                               | Status  | Covers                                                                  |
| -------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| [OPERATIONS.md](./OPERATIONS.md)                                                       | Current | Health signals, crons, Azure runtime deploy credentials, incident steps |
| [WEB_HOSTING.md](./WEB_HOSTING.md)                                                     | Current | Cloudflare and Vercel web hosting, routing, and secret ownership        |
| [BILLING.md](./BILLING.md)                                                             | Current | Stripe Individual plan: paywall rules, webhook flow, env, provisioning  |
| [EMAIL.md](./EMAIL.md)                                                                 | Current | `trycodev.com` email: Resend sending, ImprovMX receiving                |
| [security/openai-hosted-codex-approval.md](./security/openai-hosted-codex-approval.md) | Current | Approval record for the hosted Codex CLI remote-auth pattern            |

[Legal policies and account deletion](./LEGAL.md) — implementation, publication requirements and sources.

## Architecture and integration

| Document                                                                         | Status  | Covers                                                                          |
| -------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| [gen2-workspace.md](./gen2-workspace.md)                                         | Current | Gen 2 workspace: Firecracker instance, shareable membership, Codex chats        |
| [SUPERSET_WORKSPACE_OWNERSHIP.md](./SUPERSET_WORKSPACE_OWNERSHIP.md)             | Design  | Phase 1 ownership contract for a first-party Superset-powered workspace         |
| [SUPERSET_AGENT_SESSION_PLAN.md](./SUPERSET_AGENT_SESSION_PLAN.md)               | Design  | Superset agent sessions, CoDev provider ownership, and rollout gates            |
| [SUPERSET_MULTI_AGENT_HANDOFF.md](./SUPERSET_MULTI_AGENT_HANDOFF.md)             | Design  | Stepwise multi-agent integration plan and implementation handoff                |
| [GIT_PROXY.md](./GIT_PROXY.md)                                                   | Design  | Git over the control plane without credentials in the guest (unbuilt)           |
| [ARM_SUPERSET_ISOLATION_INTEGRATION.md](./ARM_SUPERSET_ISOLATION_INTEGRATION.md) | Planned | Safe Superset isolation migration into the disposable ARM VM lifecycle          |
| [arm-workspace-free-tier-phase-0.md](./arm-workspace-free-tier-phase-0.md)       | Review  | ARM free-tier Phase 0 decisions, evidence, costs, and open gates                |
| [arm-workspace-free-tier-phase-1.md](./arm-workspace-free-tier-phase-1.md)       | Review  | ARM64 image build, smoke evidence, image publication, and VM acceptance gates   |
| [arm-workspace-free-tier-phase-2.md](./arm-workspace-free-tier-phase-2.md)       | Review  | Phase 2 lifecycle evidence; integration and launch gates                        |
| [arm-workspace-free-tier-phase-3.md](./arm-workspace-free-tier-phase-3.md)       | Review  | ARM lifecycle API, Worker workflow, Azure provider, and release gates           |
| [arm-workspace-free-tier-phase-4.md](./arm-workspace-free-tier-phase-4.md)       | Review  | Provider-aware guest bridge, startup, background transcripts, and staging gates |
| [arm-workspace-free-tier-phase-5.md](./arm-workspace-free-tier-phase-5.md)       | Review  | Gated free entitlements, dynamic owner quota, active reservations, cost breaker |
| [arm-workspace-free-tier-phase-6.md](./arm-workspace-free-tier-phase-6.md)       | Review  | Free-tier UI, compute controls, quota warnings, switch dialog, and gated copy   |

## UI implementation

| Document                                                             | Status  | Covers                                                             |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [design/workspace-controls.md](./design/workspace-controls.md)       | Current | Workspace buttons, navigation states, and contributor review rules |
| [design/superset-workspace-ui.md](./design/superset-workspace-ui.md) | Design  | Gen 2 Superset workspace layout, tokens, and visual contract       |

## Product

| Document                                                           | Status  | Covers                                                              |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------- |
| [product/PRODUCT_OVERVIEW.md](./product/PRODUCT_OVERVIEW.md)       | Current | Product surfaces, account model, system shape, and roadmap boundary |
| [product/ENTERPRISE_FEATURES.md](./product/ENTERPRISE_FEATURES.md) | Design  | Long-range product vision; not a list of shipped features           |

Add new documents to the matching folder and update this index. Remove index
entries when documents are deleted.
