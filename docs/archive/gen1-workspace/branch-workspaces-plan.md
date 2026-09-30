# Branch Workspaces: Branches-First Collaboration Plan

**Status:** Phases 1–5 verified locally; production rollout remains pending
**Date:** 2026-09-16
**Product:** CoDev hosted web workspace
**Scope:** Shared branch/worktree navigation, agent visibility, code inspection, and collaboration

## 1. Product direction

Make the workspace understandable as:

> A workspace contains branches. Each active branch opens one shared branch workspace containing its code, chat, agents, changes, owner, and activity.

Use **Branches** as the primary user-facing term. Keep Git branches and worktrees separate in the backend, but do not require users to understand the Git distinction. For the first version, enforce one active shared worktree per branch so each branch has one predictable place to enter.

The existing chat-first experience remains the default inside a selected branch. The terminal remains available as an optional bottom panel and is never the first surface.

## 2. Goals

- Give users one obvious place to see every active branch/worktree.
- Show which agents are operating in each branch.
- Show the human owner separately from automated agents.
- Let users click a branch and immediately see its code, chat, changes, and agents.
- Let users enter an agent conversation reliably.
- Make agent, worktree, and provider failures understandable and recoverable.
- Keep the experience simple enough that users do not need Git or worktree knowledge.
- Preserve deep links so a branch workspace can be shared and reopened directly.

## 3. Non-goals for the first version

- Supporting multiple independent worktrees on the same branch.
- Replacing GitHub branch or pull-request workflows.
- Building a full code review system.
- Allowing unrestricted simultaneous editing by multiple agents without conflict handling.
- Exposing generated agent branch names such as `codev-agent-081620c6` as primary UI labels.

## 4. User-facing mental model

### Workspace

The top-level collaboration container. It includes the repository, members, branches, and shared activity.

### Branch

The primary navigation unit users select. A branch represents the shared coding context they want to enter.

### Branch workspace

The selected branch’s shared environment. It contains the chat, code explorer, source-control changes, agents, owner, and optional terminal.

### Agent

An automated coding session operating in a branch workspace. Agent ownership and branch ownership are separate concepts.

### Owner

The person responsible for the branch workspace. The owner is not necessarily the person who last changed a file or the provider running the agent.

## 5. Information architecture

### Workspace overview

The workspace should open to a **Branches** overview rather than directly to a raw terminal.

Each branch row or card should display:

- Human-readable branch name
- Owner
- Agent count
- Agent provider and status
- Changed-file count
- Last activity
- Branch/worktree state
- Primary action: **Open branch**

Example:

```text
main                 Yousef       No agents       Clean
chat-first-ui        Yousef       Claude working  8 changes
api-refactor          Sarah        Codex waiting   3 changes
```

Generated identifiers remain available under advanced details only.

### Persistent branch switcher

Inside a branch workspace, keep a compact branch switcher in the header or left rail. It should always expose:

- Current branch
- Branch owner
- Agent presence
- A route back to all branches

The navigation placement must remain consistent between the overview and branch workspace.

### Branch workspace

The selected branch view should contain:

- Chat as the primary surface
- Explorer for the branch’s files
- Source Control for changed files and commits
- Agents for agent conversations and controls
- Activity for branch history
- Optional terminal drawer at the bottom

The header should identify the current branch, owner, agent presence, and branch state without requiring the user to open another panel.

## 6. Interaction rules

### Branch actions

- **Open branch:** enters the shared branch workspace.
- **View changes:** opens Source Control for that branch.
- **View agents:** opens the agent list filtered to that branch.
- **More actions:** contains publish, create PR, archive, or delete actions where permitted.

Clicking a branch is the main path into its code and collaboration context. Do not make users choose between separate concepts such as “Step in” and “Open this worktree” to reach the same environment.

### Agent actions

- Clicking an agent opens its shared conversation and current status.
- Steering is available only when the provider connection and session are ready.
- A working agent must expose a reliable path to its branch workspace.
- If a session is provisioning, show `Preparing worktree…` rather than a misleading disabled action.
- If a session has no accessible worktree, explain why and provide the next available action.
- “Step in” should either open the agent conversation or be removed; it must never lead to a dead end.

### Code and changes

- Explorer always uses the selected branch/worktree context.
- Source Control always identifies the branch being reviewed.
- Diffs, commits, and publish actions must not silently operate on another branch.
- Opening a change should preserve the selected branch and provide a predictable back path.

## 7. Data and state model

The UI and backend should share explicit state for these entities:

```text
Workspace
  └── Branch
        └── Active branch workspace / worktree
              ├── Agent session(s)
              ├── Conversation(s)
              └── Activity and change summary
```

### Branch/worktree states

- `provisioning`
- `ready`
- `active`
- `syncing`
- `conflict`
- `failed`
- `disconnected`
- `stopped`

### Agent states

- `starting`
- `working`
- `waiting`
- `paused`
- `failed`
- `disconnected`
- `stopped`

The status shown in the overview, header, Mission Control, and agent details must come from the same authoritative state source. Loading and reconnecting states must not be represented as “No agents.”

## 8. Ownership and permissions

Show these separately:

- **Branch owner:** the human responsible for the branch workspace.
- **Agent:** the automated session operating there.
- **Provider:** Claude, Codex, or another configured provider.

Permissions should be explicit and independently controllable:

- View branch
- View code and changes
- View agent conversation
- Steer agent
- Edit code
- Publish branch
- Create pull request
- Pause or stop agent

The product should make it clear when a user can view a branch but cannot steer its agent or publish its changes.

## 9. Reliability requirements

### Status consistency

- Agent counts and worktree-slot counts must not contradict one another during refresh.
- Use an explicit loading/reconnecting state while status is being reconciled.
- Live count changes should be announced as contextual status, such as `3 agents working`, without moving keyboard focus.

### Provider readiness

- Validate provider connectivity before presenting an agent as ready to work.
- If a provider connection is revoked or unavailable, show the cause and recovery path before the user sends work.
- The provider actually launched must match the workspace/provider selection, or the UI must clearly confirm the selected provider.

### Entering a session

- Every active managed agent must expose an accessible conversation or worktree entry point.
- `Step in`, `Open branch`, and agent conversation navigation must resolve to a valid route.
- Disabled actions must explain what is unavailable and when the action will become available.

### Failure recovery

Every failure state must include:

- What failed
- Which branch or agent is affected
- Whether code or work is safe
- A retry, reconnect, or alternate inspection path

## 10. Design and accessibility guardrails

- Use the existing CoDev dark coding-workspace language with semantic theme tokens; support light mode as well.
- Use vector icons with accessible names; do not use emoji as structural icons.
- Use semantic buttons and links instead of clickable generic containers.
- Maintain visible keyboard focus and predictable tab order.
- Keep interactive targets at least 44px and provide at least 8px spacing between adjacent controls.
- Meet 4.5:1 text contrast in both themes and do not use color alone for status.
- Provide screen-reader labels for branch, owner, provider, and agent status.
- Announce live status changes as complete contextual phrases through one appropriate status region.
- Respect reduced-motion preferences and avoid layout-shifting transitions.
- Preserve the selected branch, filters, and scroll position when navigating back.
- Test at 375px, 768px, 1024px, and 1440px widths.

## 11. Phase roadmap

| Phase | Name                               | Depends on | Exit result                                                 |
| ----- | ---------------------------------- | ---------- | ----------------------------------------------------------- |
| 0     | Product contract                   | None       | Terminology, state, ownership, and permissions are approved |
| 1     | Branches overview                  | Phase 0    | Users can discover every branch and open one                |
| 2     | Branch workspace shell             | Phase 1    | A selected branch exposes chat, code, changes, and terminal |
| 3     | Agents and ownership               | Phase 2    | Users can see, identify, and enter agents in a branch       |
| 4     | Reliability and provider readiness | Phase 3    | Status, provider, and failure behavior are trustworthy      |
| 5     | Verification and rollout           | Phases 0–4 | The complete flow is tested and ready for production        |

### Phase 0 — Product contract

**Goal:** Agree on the simple user model before implementation begins.

**Scope:**

- Confirm **Branches** as the primary user-facing term.
- Confirm the first-version rule of one active shared worktree per branch.
- Define Workspace, Branch, Branch workspace, Worktree, Agent, Conversation, Provider, Owner, and Member.
- Define branch/worktree and agent state values.
- Define owner and collaborator permissions.
- Define URLs, deep links, and predictable back navigation.
- Decide whether multiple agents may edit one branch and what safeguards are required.
- Map GitHub issues #42–#46 to the new interaction model.

**Deliverables:**

- Approved UX terminology document
- State-transition matrix
- Ownership and permissions matrix
- Route/deep-link map
- Decision on multiple-agent branch policy

**Exit criteria:** Product decisions are written down and no implementation task depends on an unresolved terminology or permission question.

### Phase 1 — Branches overview (implemented locally)

**Goal:** Give users a simple, workspace-level view of all current branches/worktrees.

**Scope:**

- Add a workspace-level **Branches** destination.
- Render one branch row/card per active branch workspace.
- Show branch name, owner, agent count, provider/status, changed-file count, last activity, and branch state.
- Hide generated agent branch identifiers from the primary view.
- Add loading, empty, failed, disconnected, and provisioning states.
- Add the primary **Open branch** action.
- Add a deep-linkable branch route.

**Deliverables:**

- Branch list/overview
- Branch summary component
- Branch loading and failure states
- Branch route/deep-link entry point

**Exit criteria:** A user can open a workspace, see every active branch, understand who owns it and which agents are there, and open any branch without seeing a terminal first.

### Phase 2 — Branch workspace shell (implemented locally)

**Goal:** Make the selected branch a coherent shared environment.

**Scope:**

- Add the current-branch header with branch name, owner, agent presence, and state.
- Add a persistent branch switcher and a clear route back to all branches.
- Keep chat as the default surface.
- Connect Explorer to the selected branch/worktree.
- Connect Source Control to the selected branch/worktree.
- Connect Activity to the selected branch.
- Keep the terminal behind an explicit bottom-drawer action.
- Preserve branch context through navigation, refresh, and back navigation.

**Deliverables:**

- Branch workspace shell
- Current-branch header
- Persistent branch switcher
- Branch-aware Explorer, Source Control, Activity, and terminal entry points

**Exit criteria:** Entering a branch shows the correct code and changes, the chat is primary, and no code or source-control surface silently points at another branch.

### Phase 3 — Agents and ownership (implemented locally)

**Goal:** Make agents visible and enterable from the branch workspace.

**Scope:**

- Show all agents operating in the selected branch.
- Display human owner, agent name, provider, status, last activity, and permissions separately.
- Add agent conversation entry from the branch view.
- Make the branch and agent routes preserve each other’s context.
- Replace or redefine **Step in** so it opens the agent conversation or a valid worktree view.
- Show a clear provisioning state when an agent is not ready.
- Explain when a user can view but cannot steer, edit, publish, or stop an agent.

**Deliverables:**

- Branch agent list
- Agent detail/conversation entry
- Ownership and permissions display
- Reliable Step in/open-agent behavior

**Exit criteria:** Users can click a branch, identify every agent working there, and enter an agent without reaching a blank view, disabled dead end, or unrelated worktree.

### Phase 4 — Reliability and provider readiness (implemented locally)

**Goal:** Ensure the displayed collaboration state is authoritative and actionable.

**Scope:**

- Centralize status reconciliation for branches, worktrees, slots, and agents.
- Add explicit loading and reconnecting states.
- Prevent contradictory agent and slot counts during refresh.
- Add provider preflight before an agent is presented as ready.
- Surface revoked or unavailable connections before the user sends work.
- Verify that the provider label matches the provider actually launched.
- Handle provisioning, reconnecting, failed, paused, stopped, and conflict states.
- Add retry, reconnect, and alternate-inspection paths to failures.

**Deliverables:**

- Shared status/state mapping
- Provider readiness check
- Consistent failure and recovery states
- Regression coverage for GitHub issues #42–#46

**Exit criteria:** The UI never presents an unavailable agent as fully working, never contradicts its slot count during refresh, and always explains how the user can recover or inspect the affected branch.

### Phase 5 — Verification and rollout (local verification complete; production pending)

**Goal:** Verify the complete flow before enabling it broadly.

**Scope:**

- Add targeted unit tests for state mapping and route/context preservation.
- Add component tests for branch rows, agent cards, status states, ownership, and disabled-action explanations.
- Add browser tests for branch discovery, branch entry, agent entry, and terminal disclosure.
- Test three agents on three isolated branches in production.
- Test provider-disconnected, reconnecting, provisioning, and refresh-race states.
- Test keyboard navigation, focus management, screen-reader labels, responsive layouts, light/dark themes, and reduced motion.
- Test direct branch URLs and back-navigation state preservation.
- Roll out behind a feature flag if migration risk requires it.

**Deliverables:**

- Automated regression suite
- Production verification report
- Accessibility and responsive review results
- Rollout/migration checklist

**Exit criteria:** The complete branches-first collaboration flow passes the acceptance criteria in Section 12 and can be demonstrated with three agents on three isolated branches.

## 12. Acceptance criteria

- A new workspace opens to Branches, not a raw terminal.
- Every active branch is visible and clickable.
- Opening a branch shows the correct code, changes, agents, owner, and branch name.
- Three agents can run on three isolated branches without branch context being mixed.
- Each agent displays the correct provider and status.
- Clicking an agent opens its conversation or a clearly explained provisioning state.
- Step in never leads to an unavailable or blank destination.
- Worktree and agent counts remain consistent during initial load and refresh.
- Provider connection failures explain the cause and recovery path.
- Terminal access remains available but secondary.
- Branch URLs are deep-linkable and preserve navigation context.
- Keyboard navigation, focus states, contrast, responsive layouts, and reduced-motion behavior pass review.

## 13. Risks and decisions to confirm

### Recommended decisions

1. Use **Branches** as the primary user-facing label.
2. Present one active shared worktree per branch in the first version.
3. Treat branch entry as the primary action; agent entry opens the agent conversation.
4. Keep generated agent branch identifiers out of the primary UI.
5. Do not show an agent as fully working until provider and session readiness are confirmed.

### Main risks

- Multiple agents editing one branch can create conflicts and unclear ownership.
- Backend worktree state and live agent state may arrive through different streams.
- Provider selection may currently differ between workspace configuration and managed-agent launch behavior.
- Existing users may rely on the current direct workspace surface, so migration and deep-link compatibility need testing.

## 14. Existing production findings

These findings should be used as regression cases during implementation:

- [#42 Managed agents launch as Codex even when the workspace specifies Claude](https://github.com/CoDevOrg/CoDev/issues/42)
- [#43 Mission Control briefly shows no agents while all worktree slots are occupied](https://github.com/CoDevOrg/CoDev/issues/43)
- [#44 Steering a managed agent fails when the OpenAI connection is revoked](https://github.com/CoDevOrg/CoDev/issues/44)
- [#45 Mission Control shows Nothing to open for a working managed agent slot](https://github.com/CoDevOrg/CoDev/issues/45)
- [#46 Cannot step into a running managed agent from Mission Control](https://github.com/CoDevOrg/CoDev/issues/46)

## 15. Definition of done

The plan is complete when the terminology, state model, permissions, URLs, and interaction rules are approved. Implementation should then proceed phase by phase, with each phase verified before the next begins. No code is included in this document.
