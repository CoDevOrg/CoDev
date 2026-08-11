# Collaborative IDE Feature Backlog

## Product promise

CoDev is a hosted, browser-based collaborative development workspace: a team
creates a workspace from a repository, shares a link, and can jointly steer AI
agents while seeing the same code, changes, terminal activity, and decisions.
It should feel as natural to share as a Google Doc, while remaining safe for
source code and reliable when people, browsers, agents, or network connections
come and go.

This document is the implementation backlog for the collaborative IDE. It
supplements the existing architecture and delivery plan; it does not replace
the repository's security, sandbox, or deployment requirements.

Implementation is governed by
[COLLABORATIVE_IDE_EXECUTION.md](./COLLABORATIVE_IDE_EXECUTION.md). That
runbook breaks this backlog into bounded tasks suitable for a cost-conscious
coding model and requires browser-level verification for every task.

## Decisions to hold constant

- The product is browser-first and hosted; it is not a desktop IDE download.
- One workspace has one canonical integration checkout and up to **three**
  concurrent agent worktrees. A human editor is not counted as an agent.
- A shared agent session has one durable ordered conversation and one active
  turn at a time. Any eligible collaborator can add a queued instruction,
  cancel the active turn, or approve the next action. This is what "shared
  context" means; it does not mean that independent providers share hidden
  model context.
- Agents work in isolated Git worktrees. Their proposed changes reach the
  shared integration checkout only through an explicit review/merge flow.
- Provider credentials are never sent to the browser, terminal, microVM,
  worktree, logs, or agent transcript. API-key support is required; OAuth is
  added only for providers that offer an appropriate official authorization
  flow for this product.

## Global definition of done

No feature can move to `done` until all of these are true:

1. The acceptance criteria below are demonstrated in a representative browser
   flow, including the relevant disconnect/reconnect or permission edge case.
2. Unit/contract tests and a focused browser test cover the behavior.
3. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm
   build`, `pnpm test:e2e`, `pnpm rust:check`, and `git diff --check` pass, or
   a documented, pre-existing failure is separately tracked and approved.
4. Secrets, workspace membership, and sandbox/worktree boundaries are reviewed
   for the new behavior.
5. The feature's status, evidence, and any intentional follow-up are recorded
   in this file or its implementation issue before the next feature starts.

## P0 — Collaboration that feels shared

### F1. Shareable workspaces and role-based access

**Outcome:** An owner can invite people to a workspace by link or identity and
give them the least privilege they need.

**Acceptance criteria**

- Owners can create revocable, expiring invites for Viewer, Collaborator, and
  Maintainer roles.
- Viewers can inspect files, agent activity, and diffs but cannot edit, run a
  terminal command, add a prompt, or access credentials.
- Collaborators can edit shared files and co-steer sessions; Maintainers can
  manage members and approve integration changes.
- Every workspace API and realtime subscription derives authorization from the
  authenticated membership, never a client-supplied role.
- Joining, leaving, removal, and expired invites update presence immediately.

### F2. Live shared editor, files, and presence

**Outcome:** Teammates see who is present, what file they are viewing, and
edits as they happen, without silently losing work.

**Acceptance criteria**

- The workspace shows named presence, cursors/selections, active file, and a
  clear offline/reconnecting state.
- Two collaborators can edit the same text file concurrently; both converge
  after reconnecting from a temporary offline period.
- External filesystem changes from a terminal or agent are reconciled into the
  editor, or surfaced as an explicit conflict that preserves both versions.
- Binary, generated, and oversized files have deliberate non-collaborative
  handling rather than entering the text-sync path.
- A collaborator can follow another person's active file without changing
  their own edit state.

### F3. Shared agent sessions and co-steering

**Outcome:** A team sees one truthful agent transcript and can take turns
guiding the same session.

**Acceptance criteria**

- A session displays its provider, owner, worktree, model/configuration,
  current state, live tool activity, output, and ordered prompt history.
- A collaborator's instruction is attributed, appended to the durable queue,
  and is processed in order after the current turn; all members see the same
  queue and state.
- Authorized users can interrupt a running agent, with the cancellation and
  last completed tool result visible to every member.
- After a browser refresh, server restart, or reconnect, the session recovers
  its transcript, turn state, queued instructions, and stream position without
  duplicating a provider call.
- The UI explains that the shared context is the visible/durable session
  conversation and repository state, not account credentials or invisible
  context from a different provider.

## P0 — Parallel work without chaos

### F4. Three-agent workboard

**Outcome:** A workspace can run up to three intentional, visible pieces of
agent work in parallel.

**Acceptance criteria**

- The workboard has exactly three available agent slots and shows assignment,
  owner, status, worktree, provider, current task, and elapsed time for each.
- Creating a fourth active session is rejected server-side with a helpful,
  actionable response; it is not merely hidden by the UI.
- Each agent receives a detached worktree and cannot read or mutate another
  agent's worktree or host credentials.
- Agents claim files/directories before writing. Exact or overlapping claims
  are visible before a collision; collaborators can reassign, negotiate, or
  explicitly override a contested claim.
- Stopping, failing, or timing out an agent releases its claims and leaves a
  reviewable checkpoint rather than an ambiguous partial state.

### F5. Review, conflict resolution, and integration

**Outcome:** Agent output becomes team code through a clear, safe review step.

**Acceptance criteria**

- A session can prepare an immutable review checkpoint with a complete,
  binary-safe diff and test summary.
- A collaborator can compare a proposed change with the current integration
  head and see affected paths plus conflicts before approval.
- Approving a proposal validates that the review checkpoint is still current,
  resolves or blocks conflicts, then integrates exactly the reviewed content.
- Discarding a proposal removes its worktree and claims without affecting the
  integration checkout.
- The audit trail records who requested, reviewed, merged, or discarded each
  proposal and the relevant revisions.

## P0 — Bring your own agent safely

### F6. Provider connections and credential boundaries

**Outcome:** A person can connect a supported provider and choose it for an
agent without exposing their secret to teammates or the sandbox.

**Acceptance criteria**

- A user can add, validate, replace, and revoke an API key for each supported
  provider. Keys are encrypted at rest, redacted in logs, and never returned
  after creation.
- The connection UI identifies which user supplied the provider connection but
  never exposes its key or token to workspace members.
- Provider authorization is evaluated for every agent turn; removing a
  connection blocks subsequent turns cleanly without corrupting the session.
- OAuth connections use PKCE, state validation, encrypted refresh tokens,
  narrow scopes, explicit disconnect, and the provider's documented flow.
- The first supported providers are OpenAI/Codex-compatible and Anthropic;
  Cursor support is treated as a separate integration discovery task rather
  than assuming it accepts a generic API key or OAuth token.

### F7. Provider-neutral agent contract

**Outcome:** Switching providers does not weaken collaboration or safety.

**Acceptance criteria**

- Every provider adapter produces the same durable session events: turn,
  status, streamed output, tool call, tool result, usage/cost metadata when
  available, error, and cancellation.
- Provider-specific features appear as explicit capabilities, not hidden
  behavior. Unsupported controls are disabled with an explanation.
- A session keeps its provider for a turn; changing provider creates a clearly
  labeled subsequent turn/session boundary rather than mixing transcripts.
- Retries are idempotent and cannot duplicate a write, command, or provider
  charge where the provider supports idempotency keys.

## P1 — Reliability and clarity

### F8. Activity timeline and workspace recovery

**Outcome:** A teammate can understand what happened, even after being away.

**Acceptance criteria**

- A chronological activity timeline includes joins/leaves, edits, agent
  events, terminal commands, reviews, merges, conflicts, and lifecycle events.
- Users can filter the timeline by person, agent, path, or event type and jump
  from an event to the relevant file, session, or diff.
- Reconnecting clients resume from a durable event cursor; missing events are
  replayed in order and duplicate events are safely ignored.
- Hibernated workspaces clearly show what will be resumed, then restore the
  canonical checkout and valid session state without re-running completed
  agent turns.

### F9. Shared terminal with safe collaboration controls

**Outcome:** People can observe a terminal live and, when permitted, help
operate it without fighting over input.

**Acceptance criteria**

- Terminal output streams live to eligible members with reconnect-safe
  sequencing and a read-only follow mode.
- Only one explicit input holder may send input at a time; the holder is shown
  and can hand off or release control.
- All terminal commands and ownership changes are attributed in the timeline.
- Terminal permissions remain separate from editing and review permissions.

### F10. Trust, guardrails, and operability

**Outcome:** Teams can rely on CoDev for real work without surprise cost,
leaks, or invisible failure.

**Acceptance criteria**

- Workspace owners can configure concurrent-agent, turn-duration, and
  provider-spend guardrails; approaching a limit is visible before execution
  is blocked.
- The application reports actionable health for website, database, realtime,
  provider connection, orchestrator, and sandbox state without leaking secrets
  or repository content.
- Audit records cover membership, permission, credential-connection, agent,
  terminal, review, and publication actions with retention rules.
- A tested incident path lets an owner freeze a workspace: cancels turns,
  revokes terminal input, preserves evidence, and blocks new mutations until
  unfreezing.

## P2 — High-leverage follow-ons

- **Task briefs and handoffs:** turn an issue into a scoped agent brief with
  acceptance criteria, claimed paths, checkpoints, and a concise handoff.
- **Agent-generated test evidence:** agents attach the exact test commands,
  results, screenshots, and limitations to their review checkpoint.
- **Workspace templates:** reusable setup, validation, and policy presets per
  repository or organization.
- **Semantic duplicate-work warnings:** suggest related active sessions or
  issues, while never blocking work solely on a probabilistic match.
- **Notifications:** mention, review-ready, collision, failed-agent, and
  spend-limit notifications with per-user controls.

## Automated execution protocol

When an implementation agent works from this backlog, it must:

1. Select only the first incomplete feature in priority order.
2. Inspect the existing implementation and turn the feature's acceptance
   criteria into a short implementation plan plus concrete automated tests.
3. Implement, test, and fix failures until the global definition of done is
   met. It may not start the next feature while any criterion remains unmet.
4. Record links to tests and verification evidence, commit the focused change,
   then advance to the next incomplete feature.
5. Stop and report a specific blocker if completion requires a product,
   security, provider, or infrastructure decision that is not covered here.
