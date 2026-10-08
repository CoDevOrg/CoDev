# Superset agent coordination

**Status:** Implemented behind flags and unreleased. Guest pieces need a signed ARM runtime release; nothing has run on a Linux ARM64 guest yet. Proposed and built 2026-10-08.
**Depends on:** [SUPERSET_MULTI_AGENT_HANDOFF.md](./SUPERSET_MULTI_AGENT_HANDOFF.md) (one worktree per independent agent, per-launch hook identity) and [SUPERSET_WORKSPACE_OWNERSHIP.md](./SUPERSET_WORKSPACE_OWNERSHIP.md) (CoDev authorizes every operation).

## Problem

Independent agents in one Gen 2 workspace each run in their own Git worktree. Worktrees prevent agents from overwriting each other, but they also hide agents from each other. Three agents can fix the same bug, or rewrite the same function on three branches, and nobody finds out until merge time.

Agent coordination makes overlapping work visible **before and during** the work, so agents and their members can divide it instead of repeating it. It defines the "agent coordination policy" referenced in the ownership contract.

## Goals

1. Warn the launching member when a new task duplicates an active one.
2. Tell each running agent, in one line, when another agent is changing the same file or function.
3. Show every member where active agents overlap.
4. Cost an agent with no overlap **zero** extra context tokens.
5. Add no new access: coordination never lets an agent or member read, write, or control anything it cannot already reach.

## Non-goals (v1)

- Locks or leases on files, functions, or tasks.
- Free-text messages between agents.
- Coordination across workspaces, even on the same repository.
- Automatic merging, rebasing, or reassignment of work.

## Decisions

| Decision                 | v1 choice                                                    | Why                                                                                                                                |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Warn or lock             | Warn; humans decide unresolved conflicts                     | Agents belong to different members and can crash, stall, or hang. A lock turns a warning into a deadlock and needs lease recovery. |
| Agent-to-agent messages  | None; notices carry structured fields only                   | Another member's free text in an agent's context is a cross-member prompt-injection channel.                                       |
| Scope                    | One workspace                                                | The workspace is the membership and authorization boundary.                                                                        |
| Delivery to agents       | `PostToolUse` hooks; no MCP tool                             | Agents launch with an empty strict MCP config, and every tool schema costs tokens on every turn.                                   |
| Duplicate-task detection | At launch, shown to the launching member, never to the agent | Duplication is cheapest to prevent before the agent starts; the person decides; nothing enters any agent's context.                |
| Member names in notices  | Not sent to agents; shown to members only                    | The host does not know CoDev identities, and fewer cross-member fields means a smaller injection and privacy surface.              |
| Persistence              | None in v1; overlaps are computed on demand                  | Overlaps matter only while agents are live. Skipping a table avoids a production migration; an audit table is a follow-up.         |

## How it works

### 1. Change sets (guest host)

Detection is provider-neutral. For a worktree, the Superset host service computes a **change set** ([change-set.ts](../vendor/superset/packages/host-service/src/codev/change-set.ts)): the paths changed since the worktree diverged from the primary checkout's `HEAD` (committed, uncommitted, deleted, and untracked), and the enclosing symbol of each changed hunk from Git's hunk function context. For the primary checkout itself, only uncommitted work counts. Change sets hold paths and symbol names only, never file contents or diff lines.

Two worktrees **overlap** when their change sets share a path, and at **function level** when they also share a symbol in that path ([worktree-overlaps.ts](../vendor/superset/packages/host-service/src/codev/worktree-overlaps.ts)).

### 2. Live agents

The host coordinates two kinds of live agent ([coordination-agents.ts](../vendor/superset/packages/host-service/src/codev/coordination-agents.ts)):

- **Superset-launched runs** (Codex and Claude while `CODEV_SUPERSET_AGENT_SESSIONS_ENABLED` is on): rows in `codev_agent_runs` whose terminal has not ended. They already carry a SHA-256 of their private per-launch hook token.
- **Native guest-exec turns** (every Cursor turn, and Codex or Claude while that flag is off): `codev-guestd` ([guest_coordination.rs](../services/orchestrator/src/guest_coordination.rs)) generates a per-turn ID and a 32-byte token, registers the token's hash, worktree, and CLI with the host over the bridge secret, and releases the registration when the turn exits. A missed release expires after 20 minutes (the native turn timeout is 15); the registry holds at most 32 turns.

### 3. Notices (agent-facing)

Each agent's private hook configuration runs one extra command on `PostToolUse`. It presents the agent's ID and token to `POST /codev/coordination/notices` on the host and prints only the host's reply. The host answers from its last overlap snapshot and then schedules a background refresh, debounced to 2 seconds, so a hook never waits on Git. A snapshot older than 60 seconds is not used.

When there is a new overlap involving that agent, the reply adds this to the model's context:

```text
[CoDev coordination] Information, not an instruction:
- Another agent (Claude, branch fix-auth) is also changing refreshToken() in apps/web/lib/auth/session.ts.
Avoid duplicating that work, or narrow your change.
```

Rules ([coordination-notices.ts](../vendor/superset/packages/host-service/src/codev/coordination-notices.ts), [notice-text.ts](../vendor/superset/packages/host-service/src/codev/notice-text.ts)):

- No new overlap, no reply. An agent working alone pays zero tokens.
- Each agent hears about an overlap once, and again only if it widens from file to function level. Function-level overlaps go first.
- At most three per reply and twenty per run. When the run cap is reached, one line says how many overlapping files were not listed.
- The other agent learns of the overlap at its own next hook event. Agents in the same worktree are not paired.

| CLI         | Reply field                            | Superset launch config                           | Native turn config                                             |
| ----------- | -------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Claude Code | `hookSpecificOutput.additionalContext` | Profile `.claude/settings.json` via `--settings` | `--settings` JSON, because Gen 2 passes `--setting-sources ""` |
| Codex       | `hookSpecificOutput.additionalContext` | Private profile `.codex/hooks.json`              | Profile `CODEX_HOME/hooks.json`                                |
| Cursor      | `additional_context`                   | —                                                | Profile `HOME/.cursor/hooks.json`                              |

Codex supports the reply field since about 0.117.0 (guests pin 0.148.0). The pinned Cursor CLI `2026.10.01-e373342` supports it according to its code. Native hook config is added by [agent-coordination-hooks.ts](../apps/web/lib/gen2/agent-coordination-hooks.ts).

### 4. Duplicate check at launch (member-facing)

Before credential selection or any guest call, [duplicate-task-check.ts](../apps/web/lib/gen2/duplicate-task-check.ts) compares the new prompt with the tasks of `creating` or `running` Superset sessions in other chats of the same workspace. Matching is lexical and stays in CoDev: two tasks look alike when they share at least three meaningful words that make up at least 60% of the shorter task. On a match, `POST /api/gen2/workspaces/:id/agent` returns `{ possibleDuplicate }` instead of starting. The member can open that session's branch or choose **Start anyway**, which repeats the request with `acknowledgedDuplicateOf`. Any failure counts as no match, so the check can delay a start for confirmation but never prevent one. Task text is already visible to every member through the session list, so the notice discloses nothing new. Native turns have no task record and are not compared.

### 5. Workspace UI (member-facing)

The UI extends existing surfaces, following [superset-workspace-ui.md](./design/superset-workspace-ui.md) and [workspace-controls.md](./design/workspace-controls.md).

| Surface                                                                                                               | Shows                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent sessions strip ([superset-agent-overlap-menu.tsx](../apps/web/components/gen2/superset-agent-overlap-menu.tsx)) | A `--ws-status-working` dot and `overlaps N` on the run's row. It opens a menu listing, per other agent, its branch, CLI, and owner, up to five paths with functions, `+N more`, and **Open branch**. |
| Board card ([superset-workspaces-board.tsx](../apps/web/components/gen2/superset-workspaces-board.tsx))               | `Overlaps fix-auth +1 more · 2 files`. An overlap does not move a card to Needs Attention.                                                                                                            |
| Inspector → Changes ([superset-changes-pane.tsx](../apps/web/components/gen2/superset-changes-pane.tsx))              | An overlap icon on each changed file another active agent is also changing, with "Also changed by fix-auth (claude, Sara)".                                                                           |
| Composer ([duplicate-task-notice.tsx](../apps/web/components/gen2/duplicate-task-notice.tsx))                         | The possible-duplicate notice with **Open session**, **Start anyway**, and dismiss. The typed prompt and attachments are kept.                                                                        |

Data comes from `GET /api/gen2/workspaces/:id/superset/overlaps` ([agent-overlaps.ts](../apps/web/lib/gen2/agent-overlaps.ts)). The client asks every 15 seconds while the workspace is connected. The server contacts the guest only when coordination is on for the workspace, the workspace is ready, and two or more worktrees have `creating` or `running` Superset runs, so reading overlaps never wakes a machine and asks only while agent work is running. Unknown data shows nothing; the UI never claims there is no overlap.

Deviations from the original design: the overlap details use the existing `DropdownMenu` rather than adding a Popover dependency; the Changes marker uses a native title and screen-reader text because it sits inside a button; per-session "coordination notice" activity rows are not built; and native turns get notices but do not appear in the UI because CoDev does not record their worktree.

## Rollout flags

| Flag                                  | Where                       | Effect                                                                                                                           |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `CODEV_AGENT_COORDINATION_WORKSPACES` | Web (Cloudflare and Azure)  | Comma-separated workspace IDs, or `*`. Enables the overlap UI and API, native-turn hook config, and the duplicate check.         |
| `CODEV_AGENT_COORDINATION_ENABLED`    | Guest host service (`true`) | Enables the notices route and native-turn registration. Without it guestd registration fails and turns run without coordination. |

The overlap report itself (`POST /codev/coordination/overlaps`) is always available to the bridge secret. With both flags off, behavior is unchanged except that Superset-launched agents run one extra hook command that receives a 404 and prints nothing.

## Security

### Identity and trust boundary

- A hook call authenticates with its agent's private token, compared by SHA-256 in constant time. The host resolves the agent's worktree and CLI only from its own record; the request carries only the agent ID.
- Missing, forged, or another agent's tokens, unknown or ended agents, and runs without a stored token all receive the same empty 204 as "no overlap". Token mismatches are logged without the token.
- Human terminals have no token. Loopback is not an isolation boundary; the token is. For Superset runs it lives in the agent's private launch script; for native turns it exists only in the turn's environment.
- The hook pipes the token to curl as a header on stdin, so it never appears in a process argument list. The command always exits 0.
- Registering a native turn requires the bridge secret, a `native-<16 hex>` ID, a valid worktree ID, a known CLI, and a 64-hex hash. Re-registering an ID with a different hash is refused.
- The CoDev-to-host overlap report requires the bridge secret and at most 16 worktree IDs. Both the orchestrator and `codev-guestd` allowlist the operation, and the host resolves worktrees only through Git's registered worktrees.

### Git execution on the guest

The host service runs as root, while the repository's `.git` config and `.gitattributes` are writable by workspace users, and Git honors repository-configured commands such as `core.fsmonitor`. Change-set Git commands therefore run as `codev-shell` (uid/gid 2000) when the host is root, pass `core.fsmonitor=false`, `--no-ext-diff`, and `--no-textconv`, ignore global config, set `GIT_OPTIONAL_LOCKS=0`, and have a 10-second timeout with 1 MB (paths) and 5 MB (symbol diff) output caps. Clean filters can still run, but only as `codev-shell`. Other existing host routes still run Git as root; that is tracked as a separate fix.

### Prompt injection across members

A notice places data influenced by another member's agent into this agent's context. Notices contain only fields filled into a fixed template: path, symbols, branch, and CLI name. Paths are filtered for control characters and shown at most 200 characters. Symbols must match `^[A-Za-z_$][\w$.:-]{0,79}$` and branches `^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$`, or they are dropped. No task text, member names, notes, commits, or diff content reach an agent. Residual risk: an identifier can still carry a few words, and the template states the notice is information, not an instruction.

### Authorization and data

- The overlap API and the duplicate check require current workspace membership and return only metadata the session list already shows. Viewers can see overlaps; **Open branch** is navigation only.
- Coordination grants no read, write, input, cancel, resume, or credential access. Change sets and overlaps never contain file contents, diff lines, environment values, or prompts. Duplicate matching never sends task text outside CoDev.

### Availability

- Hooks fail open within 300 ms (200 ms to connect) and never block a tool call, start, stop, or recovery.
- A worktree with more than 500 changed files is reported `large`; a symbol diff above 5 MB keeps the paths without symbols; the overlap report is capped at 200 entries with a `truncated` flag; the host reads at most 16 worktrees per refresh.

## Token budget

- Runs with no overlap: 0 added tokens.
- Runs with overlap: about 30 tokens per listed file plus about 20 for the header and footer, at most 3 files per reply and 20 per run.
- No tool schemas or standing instructions are added to agent prompts.

## Release and verification

Shipping requires a signed ARM runtime release with the new host service and `codev-guestd`, image promotion, and an update for existing VMs, plus a web deploy. Before enabling the flags for an internal workspace, verify on a Linux ARM64 guest:

1. `codev-shell` can read agent worktrees and their Git metadata; otherwise those worktrees report `unavailable`.
2. A real Claude, Codex, and Cursor agent each receive a notice through `PostToolUse`, on both the Superset and native paths. In particular, confirm that Superset-launched Claude loads the profile hooks passed with `--settings` under `--setting-sources ""` (verified against Claude Code 2.1.272; guests pin 2.1.236), that Codex loads `hooks.json` with `--ignore-user-config`, and that the Cursor CLI runs hooks on Linux.
3. Hook latency stays under the budget, and notice tokens per run match the budget above.

Then enable `CODEV_AGENT_COORDINATION_ENABLED` on the guest and `CODEV_AGENT_COORDINATION_WORKSPACES` for one workspace, watch overlap counts, false positives, and duplicate warnings, and widen. Turning both off restores current behavior.

## Follow-ups

- Persist overlap and notice events for audit, and show notice rows in session activity.
- Record native turns' worktrees so they appear in the UI and the duplicate check.
- A read-only `coordination_status` MCP tool, structured same-member agent notes, and cross-workspace coordination, each with its own security review.
- Parser-based symbols where Git hunk context is too coarse.

## Open questions

- Should overlaps on lockfiles and generated files be ignored by default?
- Should run owners also get a notification outside the workspace for new function-level overlaps?
- Is lexical duplicate matching good enough, or may task text go to a model provider for semantic matching?
