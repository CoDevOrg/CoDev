# CoDev docs index

One line per document: what it covers and how far to trust it. Repository
rules for agents live in [`AGENTS.md`](../AGENTS.md); the product overview is
[`README.md`](../README.md) and [`PRD.md`](../PRD.md).

**Current** means it is kept in step with the code. **Design** means it records
intent that may have drifted, so confirm against the code. **History** means it is
kept for the record only.

## Operating the product

| Document                                                                               | Status  | Covers                                                                  |
| -------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| [OPERATIONS.md](./OPERATIONS.md)                                                       | Current | Health signals, crons, Azure runtime deploy credentials, incident steps |
| [SECURITY.md](./SECURITY.md)                                                           | Current | Control plane vs Firecracker guest boundary, credential handling        |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)                                           | Current | Per-session checklist for design-partner launches                       |
| [EMAIL.md](./EMAIL.md)                                                                 | Current | `trycodev.com` email: Resend sending, ImprovMX receiving                |
| [OAUTH_SETUP.md](./OAUTH_SETUP.md)                                                     | Current | Provider subscription sign-in from inside a workspace terminal          |
| [security/openai-hosted-codex-approval.md](./security/openai-hosted-codex-approval.md) | Current | Approval record for the hosted Codex CLI remote-auth pattern            |

## Architecture and integration

| Document                                                                                   | Status  | Covers                                                                   |
| ------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------ |
| [gen2-workspace.md](./gen2-workspace.md)                                                   | Current | Gen 2 workspace: Firecracker instance, shareable membership, Codex chats |
| [SUPERSET_WORKSPACE_OWNERSHIP.md](./SUPERSET_WORKSPACE_OWNERSHIP.md)                       | Design  | Phase 1 ownership contract for a first-party Superset-powered workspace  |
| [SUPERSET_AGENT_SESSION_PLAN.md](./SUPERSET_AGENT_SESSION_PLAN.md)                         | Design  | Superset agent sessions, CoDev provider ownership, and rollout gates     |
| [provider-oauth-openai-codex.md](./provider-oauth-openai-codex.md)                         | Current | How a member connects OpenAI Codex (official CLI auth cache)             |
| [openai-codex-hosted-subscription-bridge.md](./openai-codex-hosted-subscription-bridge.md) | Current | Running the Codex CLI headless in the cloud with that cache              |
| [GIT_PROXY.md](./GIT_PROXY.md)                                                             | Design  | Git over the control plane without credentials in the guest (unbuilt)    |

## Product

| Document                                                                     | Status | Covers                                                                         |
| ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| [product/ENTERPRISE_FEATURES.md](./product/ENTERPRISE_FEATURES.md)           | Design | Long-range product vision; not a list of shipped features                      |
| [session-imports-current-mockup.html](./session-imports-current-mockup.html) | Design | Standalone current-state mockup and redesign brief for imported-session review |

## Audits and history

| Document | Status | Covers |
| --- | --- | --- |
| [archive/PLAN.md](./archive/PLAN.md) | History | Original delivery plan; does not describe today's system |
| [archive/gen1-workspace/specs/BYOK_AND_CREDENTIAL_HIERARCHY_SPEC.md](./archive/gen1-workspace/specs/BYOK_AND_CREDENTIAL_HIERARCHY_SPEC.md) | History | Gen 1 credential hierarchy and provider integration design |
| [archive/gen1-workspace/specs/DUAL_TIER_SETTINGS_SPEC.md](./archive/gen1-workspace/specs/DUAL_TIER_SETTINGS_SPEC.md) | History | Gen 1 personal and organization settings with OpenFGA |
| [archive/gen1-workspace/specs/FLOW_AND_HIBERNATION_SPEC.md](./archive/gen1-workspace/specs/FLOW_AND_HIBERNATION_SPEC.md) | History | Gen 1 sharing, OpenFGA authorization, and hibernation design |
| [archive/gen1-workspace/specs/SECURITY_OPERATIONS_AND_RATE_LIMITING_SPEC.md](./archive/gen1-workspace/specs/SECURITY_OPERATIONS_AND_RATE_LIMITING_SPEC.md) | History | Gen 1 WebSocket, PTY, and rate-limit design |
| [archive/gen1-workspace/BACKEND_FRONTEND_INTEGRATION.md](./archive/gen1-workspace/BACKEND_FRONTEND_INTEGRATION.md) | History | Gen 1 workspace API contract and integration design |
| [archive/gen1-workspace/WORKSPACE_CONSOLIDATION.md](./archive/gen1-workspace/WORKSPACE_CONSOLIDATION.md) | History | Gen 1 and Gen 2 runtime consolidation record |
| [archive/gen1-workspace/workspace-startup-performance-plan.md](./archive/gen1-workspace/workspace-startup-performance-plan.md) | History | Gen 1 startup performance investigation and plan |
| [archive/gen1-workspace/branch-workspaces-plan.md](./archive/gen1-workspace/branch-workspaces-plan.md) | History | Gen 1 branches-first collaboration plan |
| [archive/gen1-workspace/branch-workspaces-phase-5-verification.md](./archive/gen1-workspace/branch-workspaces-phase-5-verification.md) | History | Gen 1 embedded Orca rollout verification |
| [archive/gen1-workspace/agent-session-portability.md](./archive/gen1-workspace/agent-session-portability.md) | History | Gen 1 agent session portability design and status |
| [archive/gen1-workspace/SUPERSET_ADOPTION_MANIFEST.md](./archive/gen1-workspace/SUPERSET_ADOPTION_MANIFEST.md) | History | Gen 1 to Gen 2 Superset adoption plan |
| [archive/gen1-workspace/CODEV_FEATURES.md](./archive/gen1-workspace/CODEV_FEATURES.md) | History | Gen 1 shipped feature inventory |
| [archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_FEATURES.md](./archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_FEATURES.md) | History | Gen 1 collaborative IDE backlog and product promise |
| [archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_EXECUTION.md](./archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_EXECUTION.md) | History | Gen 1 collaborative IDE execution rules |
| [archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_TASK_STATE.md](./archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_TASK_STATE.md) | History | Gen 1 collaborative IDE scheduler ledger |
| [archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_FIXTURES.md](./archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_FIXTURES.md) | History | Gen 1 verification fixture routes |
| [archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_EVIDENCE.md](./archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_EVIDENCE.md) | History | Gen 1 screenshot evidence layout |
| [archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_BASELINE_AUDIT.md](./archive/gen1-workspace/collaborative-ide/COLLABORATIVE_IDE_BASELINE_AUDIT.md) | History | Gen 1 baseline audit from August 2026 |
| [archive/gen1-workspace/audits/WORKSPACE_UI_AUDIT.md](./archive/gen1-workspace/audits/WORKSPACE_UI_AUDIT.md) | History | Gen 1 workspace UI audit from 2026-09-12 |
Put new documents in the matching folder and add a row here in the same change.
Move a document to `archive/` once it no longer describes the system.
