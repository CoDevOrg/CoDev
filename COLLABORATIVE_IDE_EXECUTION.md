# Collaborative IDE Execution Runbook

## Goal

Deliver [COLLABORATIVE_IDE_FEATURES.md](./COLLABORATIVE_IDE_FEATURES.md) with
small, independently verifiable tasks. This document is written for a
cost-conscious coding agent, so it removes open-ended exploration and makes
the evidence required for completion explicit.

## Model and cost policy

- Use the smallest available coding model for implementation, focused tests,
  and visual verification. Start at low reasoning effort.
- Use a stronger model only after the small model has produced a concrete
  blocker, failing test, or design decision that cannot be resolved from the
  code, tests, and this backlog. Escalate one task only; return to the small
  model afterward.
- Do not use pro/maximum reasoning, multi-agent delegation, or broad
  repository-wide refactors for a normal task.
- Start each task with only the relevant feature section, relevant source
  files, their direct tests, and `AGENTS.md`. Do not load the entire backlog,
  generated assets, lockfiles, or unrelated history.
- Use `rg` for source discovery, `apply_patch` for edits, and project commands
  from `AGENTS.md` for validation. Do not introduce Docker; use Apple
  Container if local containers are required.
- Stop after two unsuccessful approaches and record a concise blocker. Do not
  spend tokens guessing through repeated rewrites.

OpenAI's current guidance similarly recommends an intentional reasoning
effort, reserving the highest settings for work with measured value, and using
lean prompts plus only relevant tools to reduce token use. [Official OpenAI
model guidance](https://developers.openai.com/api/docs/guides/latest-model)

## Required task contract

Every task prompt must contain exactly these fields:

```text
Task ID and title:
One user-visible outcome:
In scope:
Out of scope:
Relevant files/tests:
Implementation constraints:
Required targeted checks:
Required UI flow:
Screenshot evidence:
Done when:
Stop and report when:
```

### Size limit

One task changes one observable behavior and its tests. Aim for 30–90 minutes
of focused work. Split work further when it needs more than one new API surface
plus one UI surface, touches an unrelated subsystem, or cannot name a single
user-visible outcome.

## Mandatory execution loop

1. Read `COLLABORATIVE_IDE_TASK_STATE.md`, `AGENTS.md`, the assigned task
   card, and only its relevant code/tests. The ledger's **Current task** is
   authoritative.
2. State the smallest plausible implementation plan in at most five bullets.
3. Make the local change and add or update the targeted tests.
4. Run the targeted tests, formatter/linter/type check for the changed package,
   and fix failures. Do not defer a failure to the next task.
5. Start the local application or use an existing approved local deployment.
6. **Use Computer Use** to operate the application through the real UI:
   navigate the specified flow, click the specified controls, and confirm the
   visible outcome. Do not replace this with code inspection, a direct API
   call, or a Playwright-only assertion.
7. Capture at least one screenshot of the final success state and one of an
   important edge/error state when the task has one. Include the task ID and a
   short description in the task result. Save artifacts under
   `artifacts/verification/<task-id>/` (or report the local screenshot paths
   when the environment owns screenshots).
8. Commit and push the validated task change to
   `codex/collaborative-ide-automation`, then use its ready Vercel preview URL
   for the required Computer Use flow.
9. Run the required project-wide checks before completing a feature boundary;
   for a small internal task, run the scoped checks now and defer only the full
   suite to its final integration task.
10. Only after every required check and screenshot has succeeded, mark the
   current task `completed` in `COLLABORATIVE_IDE_TASK_STATE.md`, add its
   evidence, and set the following ordered card as **Current task**.
11. Commit and push the Markdown ledger update, then end the run immediately.
    **Never begin, inspect, or plan the next task in the same scheduler run.**

If the app cannot be opened—for example, required local credentials are
missing—the agent must still attempt Computer Use, capture the visible blocker,
and report exactly what is needed. It may not claim the task is complete or
advance the ledger.

## Scheduler invariant

One scheduler invocation owns one task card only. A card may advance the ledger
only when it is `completed`; a `blocked` card remains the Current task until a
user resolves the blocker or explicitly changes its priority. This prevents a
later scheduler invocation from silently skipping unfinished work.

## Visual verification rules

- Use the Computer Use skill through the local browser/application, preferring
  accessibility-based clicks and reading fresh UI state after every action.
- Use a clean browser context or two distinct signed-in identities whenever a
  task changes collaboration, permissions, shared state, or invitations.
- Verify what a user can see: labels, controls, live status, disabled states,
  errors, and recovery. A screenshot must show the relevant UI, not merely a
  terminal window.
- Never enter real API keys, OAuth tokens, or other secrets through Computer
  Use. Use development fixtures/test accounts. A real OAuth consent or
  credential-entry step is a user handoff, not an automated test action.
- Browser automation tests remain required where appropriate; Computer Use is
  additional final evidence, not a replacement for repeatable tests.

## Branch, commit, push, and preview rules

The scheduler uses one persistent integration branch:

```text
codex/collaborative-ide-automation
```

- On its first run, create this branch from the current `origin/main`; on later
  runs, switch to it and fast-forward from its remote tracking branch.
- Never push, merge, rebase, or force-push `main`. Never create a production
  deployment from the scheduler.
- Before making a change, inspect `git status --short`. If unrelated changes
  are present, stop and report them instead of overwriting or absorbing them.
- Once local checks pass, commit only the current task's source, tests, and
  required Markdown evidence. Push that commit to the persistent branch.
- Treat the pushed commit's Vercel preview deployment as a required validation
  environment. Obtain its preview URL, wait for it to become ready with a
  bounded wait, then execute the task's required Computer Use flow against it
  and capture screenshots.
- Only after preview validation succeeds may the scheduler mark the task
  complete in the Markdown ledger. Commit and push that ledger update as a
  separate small commit; record the preview URL and validated source commit in
  the ledger.
- If the branch push or preview deployment fails, record the exact failure,
  leave the task incomplete, and end the run. Do not test or deploy production
  as a fallback.

## Task sequence

These cards are ordered. Before coding a card, the agent confirms whether an
equivalent behavior already exists; if so, it writes evidence and advances to
the smallest genuinely missing card.

### Foundation and verification

| ID | Small task | Required UI flow |
| --- | --- | --- |
| B0.1 | Inventory existing collaboration, agent, credential, and review behavior against F1–F10; mark each criterion `complete`, `partial`, or `missing`. No product code. | Open a workspace and capture the current IDE shell and activity state. |
| B0.2 | Create a stable local verification entry point and documented fixture identities/data for browser flows. Do not add real secrets. | Start the app, open the fixture workspace, and capture the ready state. |
| B0.3 | Add a reusable screenshot/evidence convention to the test tooling or docs. | Run one small flow and save/record its screenshot evidence. |
| B0.4 | Reconcile the current two-agent limit with the desired three-agent requirement in contracts, limits, and tests before changing runtime capacity. | Open the agent/worktree UI and capture its current limit/state. |

### F1 — Shareable workspaces and role-based access

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F1.1 | Define/validate Viewer, Collaborator, and Maintainer capabilities in the shared contract and server authorization boundary. | Sign in as a Viewer fixture; show a prohibited control disabled or absent. |
| F1.2 | Implement one invite lifecycle slice: create a time-limited invite and accept it once. | Owner creates invite; second fixture accepts it; capture member presence. |
| F1.3 | Add invite revocation and expiry enforcement, including server-side tests. | Revoke an invite and show the recipient can no longer join. |
| F1.4 | Add member-role management and immediate realtime membership refresh. | Change a member from Collaborator to Viewer and show controls update live. |

### F2 — Shared editor, files, and presence

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F2.1 | Define durable presence events for joined/left, active file, and cursor state. | Two fixtures join one file and show both presence indicators. |
| F2.2 | Render named presence and active-file state in the IDE without changing editor synchronization. | Click between files as one fixture; observe the other fixture update. |
| F2.3 | Add cursor/selection rendering for one collaborator. | Select text as fixture A; capture the selection marker in fixture B. |
| F2.4 | Add reconnect/resubscribe replay for presence and document state. | Disconnect/reconnect a fixture and show it returns to the current document. |
| F2.5 | Surface a single external-file-change conflict state without overwriting either version. | Cause the fixture conflict and capture the resolution choices. |

### F3 — Shared sessions and co-steering

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F3.1 | Define a durable shared-session event schema and ordered turn queue. | Open a session and capture its empty/idle queue. |
| F3.2 | Render the provider, owner, worktree, state, and ordered transcript. | Start/use a fixture session and capture its metadata/transcript. |
| F3.3 | Allow one eligible collaborator to enqueue one instruction with attribution. | Fixture B queues a prompt while fixture A observes it live. |
| F3.4 | Add authorized interrupt/cancellation state with a visible last completed action. | Interrupt a controlled fixture turn and capture the final state. |
| F3.5 | Restore transcript, queue, and stream cursor after browser refresh. | Refresh fixture B mid-session and confirm no duplicate queued instruction. |

### F4 — Three-agent workboard and collision controls

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F4.1 | Raise the server-side active-session limit from two to three, with contract and limit tests. | Create/show three active fixture slots. |
| F4.2 | Make the workboard show assignment, owner, provider, status, and elapsed time for each slot. | Capture the three-slot workboard. |
| F4.3 | Reject a fourth active session server-side with an actionable UI error. | Attempt the fourth session and capture the error. |
| F4.4 | Implement one exact-path claim before agent writes. | Start an agent claim and show the claimed path in the workboard. |
| F4.5 | Surface an overlapping claim as contested; provide reassign or cancel, not silent overwrite. | Create two overlapping fixture claims and capture the warning. |
| F4.6 | Release claims and preserve a checkpoint on stop/fail/timeout. | Stop a fixture agent and show released claim plus checkpoint. |

### F5 — Review and integration

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F5.1 | Create an immutable review checkpoint with revision and diff metadata. | Mark a fixture session review-ready and capture its checkpoint. |
| F5.2 | Render a binary-safe diff summary and affected-path list. | Open a review and capture the diff/paths panel. |
| F5.3 | Reject stale checkpoint approval before any merge action. | Change integration state, try approval, and capture the stale warning. |
| F5.4 | Integrate exactly one current reviewed checkpoint with audit attribution. | Approve a fixture checkpoint and capture the integration/audit result. |
| F5.5 | Discard a proposal idempotently and remove its worktree/claims. | Discard a fixture proposal and capture its final state. |

### F6/F7 — Provider connections and neutral contract

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F6.1 | Define a provider-connection record with encrypted, server-only credential handling. | Open settings and capture a connection status with no secret displayed. |
| F6.2 | Implement API-key add/replace/revoke for one provider using test-only credentials. | Add then revoke a fixture connection; capture both status changes. |
| F6.3 | Reauthorize every turn and block the next turn after a connection is revoked. | Revoke connection, try a new fixture turn, capture the safe failure. |
| F6.4 | Research and document an official OAuth flow for one provider before implementing it. No consent UI yet. | Open the connection UI and capture the planned/unavailable OAuth state. |
| F6.5 | Implement OAuth only after the documented provider-specific design is approved and testable without real credentials. | Use a mock/fixture callback; never automate actual consent. |
| F7.1 | Normalize one provider's durable turn/status/output/tool events. | Run a fixture provider session and capture its standardized event view. |
| F7.2 | Add explicit capability flags and unavailable-control explanations. | Choose a restricted fixture provider and capture disabled controls. |
| F7.3 | Make turn-level provider switching explicit and prevent mixed transcripts. | Switch after a completed fixture turn and capture the boundary label. |

### F8–F10 — Recovery, terminal, and guardrails

| ID | Small task | Required UI flow |
| --- | --- | --- |
| F8.1 | Persist and render one chronological workspace activity event. | Trigger an event and capture the corresponding timeline row. |
| F8.2 | Add filter/jump from a timeline event to its file/session/diff. | Filter and jump from a fixture agent event. |
| F8.3 | Replay activity from a durable cursor after reconnect. | Reconnect a fixture and capture the missing events appearing once. |
| F9.1 | Add read-only live terminal follow mode. | Fixture B follows fixture A's terminal output. |
| F9.2 | Add one explicit terminal-input holder and handoff control. | Hand off input and capture the visible holder change. |
| F10.1 | Add one configurable concurrent-agent or turn-duration guardrail. | Set a fixture guardrail and capture an approaching/blocked state. |
| F10.2 | Add one health card with actionable, redacted recovery guidance. | Simulate a safe fixture failure and capture the health card. |
| F10.3 | Add owner freeze/unfreeze control that blocks new mutations and records an audit event. | Freeze a fixture workspace, attempt a mutation, then capture the blocked state. |

## Completion record template

Append this record to the task tracker or implementation issue at the end of
each task:

```text
Task: F?.?
Status: done | blocked
Changed files:
Targeted checks and result:
UI flow performed:
Screenshot paths/descriptions:
Known limitations:
Next task or precise blocker:
```

## Persistent task ledger

`COLLABORATIVE_IDE_TASK_STATE.md` is the only mutable scheduler state. Do not
infer completion from a commit, a passing unit test, or a prior chat message.
The scheduler reads the Current task at the start of every run and updates it
only at the very end of a successful run.

## Automation prompt

Use this as the recurring Codex automation prompt after B0.1 has established
the baseline:

```text
Work in /Users/yousefmaher/CoDev using COLLABORATIVE_IDE_FEATURES.md and
COLLABORATIVE_IDE_EXECUTION.md. Read COLLABORATIVE_IDE_TASK_STATE.md; its
Current task is the one and only task for this run. Use the smallest available
coding model and low reasoning effort. Read only the assigned card, AGENTS.md,
relevant source files, and direct tests. Make one observable behavior change,
add/adjust targeted tests, run them, then use Computer Use to execute the
card's required UI flow. Capture the required screenshots and record evidence.
Work only on the persistent branch `codex/collaborative-ide-automation`; never
push, merge, rebase, or force-push `main`. After local checks pass, commit and
push the current task change, wait for its Vercel preview deployment, and use
Computer Use to verify the required UI flow against the preview URL. Only
after all validation succeeds, mark this task completed in the Markdown ledger,
record the preview URL/commit/screenshots, commit and push that ledger update,
and set the next ordered incomplete card as Current task. End the run
immediately after that; never start the next card in the same run. Stop after
two failed approaches, a dirty worktree containing unrelated changes, a failed
push/preview, or a credentials/product/security decision; record the precise
blocker, leave the Current task unchanged, and do not claim completion.
```
