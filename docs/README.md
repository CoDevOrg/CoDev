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

| Document                                                                                   | Status  | Covers                                                                |
| ------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------- |
| [BACKEND_FRONTEND_INTEGRATION.md](./BACKEND_FRONTEND_INTEGRATION.md)                       | Current | Contract between the workspace frontend and the control-plane APIs    |
| [WORKSPACE_CONSOLIDATION.md](./WORKSPACE_CONSOLIDATION.md)                                 | Current | Sandbox/IDE consolidation; what shipped and what is still gated       |
| [branch-workspaces-plan.md](./branch-workspaces-plan.md)                                   | Current | Branches-first collaboration plan, phases 1 to 5                      |
| [branch-workspaces-phase-5-verification.md](./branch-workspaces-phase-5-verification.md)   | Current | Verification record for the branch-workspaces rollout                 |
| [provider-oauth-openai-codex.md](./provider-oauth-openai-codex.md)                         | Current | How a member connects OpenAI Codex (official CLI auth cache)          |
| [openai-codex-hosted-subscription-bridge.md](./openai-codex-hosted-subscription-bridge.md) | Current | Running the Codex CLI headless in the cloud with that cache           |
| [agent-session-portability.md](./agent-session-portability.md)                             | Current | Capsule v0 contract, adapter boundary, and durable import storage     |
| [GIT_PROXY.md](./GIT_PROXY.md)                                                             | Design  | Git over the control plane without credentials in the guest (unbuilt) |

## Product

| Document                                                           | Status | Covers                                                    |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------- |
| [product/ENTERPRISE_FEATURES.md](./product/ENTERPRISE_FEATURES.md) | Design | Long-range product vision; not a list of shipped features |

## Original specs (`specs/`)

Written before the Azure-only runtime; each carries a status banner.

| Document                                                                                                     | Status | Covers                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------- |
| [specs/BYOK_AND_CREDENTIAL_HIERARCHY_SPEC.md](./specs/BYOK_AND_CREDENTIAL_HIERARCHY_SPEC.md)                 | Design | Credential resolution order, BYOK, provider OAuth, key encryption |
| [specs/DUAL_TIER_SETTINGS_SPEC.md](./specs/DUAL_TIER_SETTINGS_SPEC.md)                                       | Design | Personal vs organization settings, routes, OpenFGA permissions    |
| [specs/FLOW_AND_HIBERNATION_SPEC.md](./specs/FLOW_AND_HIBERNATION_SPEC.md)                                   | Design | End-to-end sharing flow and workspace auto-hibernation            |
| [specs/SECURITY_OPERATIONS_AND_RATE_LIMITING_SPEC.md](./specs/SECURITY_OPERATIONS_AND_RATE_LIMITING_SPEC.md) | Design | Rate limiting tiers, cost safety, telemetry, beta access          |

## Collaborative IDE program (`collaborative-ide/`)

A scheduler-driven backlog. `COLLABORATIVE_IDE_TASK_STATE.md` is its ledger (over
200 KB, and excluded from search by the root `.ignore`); read only the part you need.

| Document                                                                                       | Status  | Covers                                                     |
| ---------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| [COLLABORATIVE_IDE_FEATURES.md](./collaborative-ide/COLLABORATIVE_IDE_FEATURES.md)             | Current | Feature backlog and product promise                        |
| [COLLABORATIVE_IDE_EXECUTION.md](./collaborative-ide/COLLABORATIVE_IDE_EXECUTION.md)           | Current | Execution rules, verification gates, the automation prompt |
| [COLLABORATIVE_IDE_TASK_STATE.md](./collaborative-ide/COLLABORATIVE_IDE_TASK_STATE.md)         | Current | Scheduler ledger: current task and completed-task log      |
| [COLLABORATIVE_IDE_FIXTURES.md](./collaborative-ide/COLLABORATIVE_IDE_FIXTURES.md)             | Current | Verification fixture routes                                |
| [COLLABORATIVE_IDE_EVIDENCE.md](./collaborative-ide/COLLABORATIVE_IDE_EVIDENCE.md)             | Current | Screenshot evidence layout                                 |
| [COLLABORATIVE_IDE_BASELINE_AUDIT.md](./collaborative-ide/COLLABORATIVE_IDE_BASELINE_AUDIT.md) | History | B0.1 inventory of what existed in August 2026              |

## Audits and history

| Document                                                       | Status  | Covers                                                           |
| -------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| [audits/WORKSPACE_UI_AUDIT.md](./audits/WORKSPACE_UI_AUDIT.md) | Current | 27 workspace UI findings from 2026-09-12                         |
| [archive/PLAN.md](./archive/PLAN.md)                           | History | Original AWS-era delivery plan; does not describe today's system |

Put new documents in the matching folder and add a row here in the same change.
Move a document to `archive/` once it no longer describes the system.
