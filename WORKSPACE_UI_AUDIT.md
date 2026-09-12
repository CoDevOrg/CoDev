# Workspace UI bug audit

Date: 2026-09-12 (America/Toronto)  
Repository baseline: `968a2d4a17e9dca9b7fdae7746846b6253074f3a`  
Application: CoDev hosted website, local web control plane at `http://localhost:3001`  
Live workspace inspected: `/workspaces/dd576dab-de07-4e94-be6b-7613b5ba626e` (blank/folder workspace)

## Summary

This audit records **27 actionable findings** in the workspace UI and its interaction logic. The most serious problems concern agent identity, resuming chats in the wrong checkout, misleading stop/capacity feedback, lost drafts, and keyboard interaction with obscured content.

This is a bounded audit, not a claim that every possible bug has been found. The report distinguishes browser observations, directly executed function reproductions, and source-confirmed defects. Failure paths and multi-member scenarios were inspected in code rather than exercised against other people's sessions. No agents were stopped, messages sent, invites created, permissions changed, or files edited through the workspace during this audit. Only this report was added to the repository.

The earlier stop fix is present in the inspected source, but does **not** cover the fallback `local:tab:<tabId>` identity now emitted by Mission Control. See WUI-01.

### Evidence labels and priorities

- **Browser:** reproduced through the running local UI and its accessibility tree.
- **Executed:** reproduced by loading the actual source functions into a small in-memory Node/TypeScript harness; no application state was mutated.
- **Source:** concrete behavior follows from inspected code; the triggering scenario still needs an end-to-end regression test.
- **P1:** high-impact loss, incorrect target, or blocked essential interaction.
- **P2:** broken or misleading interaction, recovery, or state presentation.

### Findings index

| ID     | Priority | Finding                                                                             | Evidence                            |
| ------ | -------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| WUI-01 | P1       | Fallback chat agents cannot be stopped, or target a literal `tab` ID                | Executed + source                   |
| WUI-02 | P2       | Legacy pane IDs produce incorrect agent deduplication                               | Executed + source                   |
| WUI-03 | P2       | Non-agent status rows suppress genuine chat agents                                  | Executed + source                   |
| WUI-04 | P1       | Superseded chat cleanup uses a close reason the embed rejects                       | Source                              |
| WUI-05 | P1       | History resumes a conversation in the active checkout, not its original checkout    | Source                              |
| WUI-06 | P2       | Step in selects a worktree rather than the chosen agent tab                         | Source                              |
| WUI-07 | P2       | Agent counts are presented as worktree capacity                                     | Browser + source                    |
| WUI-08 | P2       | Stop confirmation promises a freed slot for every stop plan                         | Browser + source                    |
| WUI-09 | P2       | Stop and Pause lack their own pending state                                         | Source                              |
| WUI-10 | P2       | Failed steering loses the typed instruction                                         | Source                              |
| WUI-11 | P1       | Agent modal leaves keyboard focus behind its scrim                                  | Browser + source                    |
| WUI-12 | P2       | Claims are attributed to other agents sharing a worktree                            | Executed + source                   |
| WUI-13 | P2       | Failed agent/coordination polls silently preserve apparently live data              | Source                              |
| WUI-14 | P2       | Switching channels discards unsent drafts                                           | Browser + source                    |
| WUI-15 | P1       | Failed channel sends discard the submitted text                                     | Source                              |
| WUI-16 | P1       | Channel overlay leaves the hidden agent chat keyboard-accessible                    | Browser + source                    |
| WUI-17 | P2       | Failed transcript loads look like empty conversations                               | Source                              |
| WUI-18 | P2       | Channel messages older than the latest 60 are inaccessible                          | Source                              |
| WUI-19 | P2       | Incoming channel messages force readers to the bottom                               | Source                              |
| WUI-20 | P2       | Channel polling races with sends and other polls                                    | Source                              |
| WUI-21 | P2       | Enter handlers ignore IME composition                                               | Source                              |
| WUI-22 | P2       | Saving team status has no visible failure handling                                  | Source                              |
| WUI-23 | P2       | Explorer claim controls operate on a default path/slot instead of the user's target | Browser + source                    |
| WUI-24 | P2       | Activity jump controls ignore the event's file and session targets                  | Source                              |
| WUI-25 | P2       | Persistent connection failures are disguised as an indefinite startup               | Source; earlier session observation |
| WUI-26 | P1       | Review selection falls back to an unrelated worktree's checkpoint                   | Executed + source                   |
| WUI-27 | P2       | New-channel creation allows duplicate pending submissions                           | Source                              |

## Agent controls and capacity

### WUI-01 — Fallback agents use a stop identity the planner does not understand

**P1 · Executed + source**

- **Trigger:** a launched/restored chat has no provider status row, and its worktree is shared or is the workspace root.
- **Actual:** the panel creates `local:tab:<tabId>`. The stop planner strips only `local:` and treats the remaining `tab:<tabId>` as a pane key. For ordinary IDs it returns `unsupported`; for UUID IDs it returns `close-tab` with the literal ID `tab`.
- **Executed evidence:** `local:tab:tab-a` → `{"kind":"unsupported"}`. `local:tab:11111111-1111-4111-8111-111111111111` → `{"kind":"close-tab","tabId":"tab","siblingCount":0}` with a non-releasable root.
- **Impact:** the original failure can still occur. The UUID case can announce success while leaving the intended agent running because `handleStop` does not verify that the requested tab was actually closed.
- **Sources:** [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 239–247 and 463–475; [codev-agent-stop-plan.ts](packages/ide/src/renderer/src/web/codev-agent-stop-plan.ts), lines 42–62; [stable-pane-id.ts](packages/ide/src/shared/stable-pane-id.ts), `parsePaneKey`.
- **Acceptance:** use explicit tab identity, cover fallback IDs, UUID tab IDs, stable pane IDs and legacy numeric IDs; verify the selected tab disappears before success is reported.

### WUI-02 — Legacy pane IDs break agent deduplication in two directions

**P2 · Executed + source**

- **Trigger:** retained statuses use keys such as `tab-a:0` and `tab-b:0`.
- **Actual:** `distinctLocalAgentEntries` supports only stable pane keys, so two legacy tabs in one worktree collapse into one status agent. Separately, `localAgentTabsWithoutStatus` cannot associate the legacy status with its tab and creates an additional fallback row for it.
- **Executed evidence:** two legacy entries in worktree `w` produce only the first entry. A chat tab `tab-a` with status `tab-a:0` is still returned by `localAgentTabsWithoutStatus`.
- **Impact:** missing or duplicate cards, misleading counts, and incorrect sibling counts during stop planning.
- **Sources:** [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 249–260; [codev-local-agent-tabs.ts](packages/ide/src/renderer/src/components/right-sidebar/codev-local-agent-tabs.ts), `localAgentTabsWithoutStatus`.
- **Acceptance:** normalize both supported pane formats once, and use that identity consistently in counting, navigation and stopping.

### WUI-03 — A non-agent status row hides a chat agent

**P2 · Executed + source**

- **Trigger:** a chat tab exists and has a stable status key, but its status lacks `agentType`.
- **Actual:** the status-agent path filters it out, while the fallback path suppresses the tab because it considers every status key authoritative.
- **Executed evidence:** a `viewMode: 'chat'` tab with a stable-key status `{}` returns no fallback agent.
- **Impact:** a real chat disappears from Mission Control and its visible controls.
- **Sources:** [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 177–186; [codev-local-agent-tabs.ts](packages/ide/src/renderer/src/components/right-sidebar/codev-local-agent-tabs.ts), construction of `statusTabIds`.
- **Acceptance:** only suppress a fallback when a status row actually qualifies for rendering as its corresponding agent.

### WUI-04 — Superseded chats are not retired because their close request is rejected

**P1 · Source**

- **Trigger:** reopen a historical chat while an embedded chat already exists in that worktree.
- **Actual:** `supersedeWorktreeAgentTabs` requests `closeTab(id, { reason: 'user' })`. The terminal store explicitly returns without closing an embedded chat for that reason. The cleanup timer then stops without checking the result.
- **Impact:** old agents can accumulate while the workflow claims to replace them, contributing to confusing live-agent counts.
- **Sources:** [codev-retire-superseded-chat.ts](packages/ide/src/renderer/src/web/codev-retire-superseded-chat.ts), replacement-arrived branch; [terminals.ts](packages/ide/src/renderer/src/store/slices/terminals.ts), lines 1582–1600; [CodevChatHistorySection.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevChatHistorySection.tsx), lines 175–181.
- **Acceptance:** retire only the intended superseded session after its replacement succeeds, using a permitted lifecycle operation and verifying completion. Do not indiscriminately close deliberately concurrent agents.

### WUI-05 — Opening history resumes against the currently active worktree

**P1 · Source**

- **Trigger:** worktrees A and B belong to the same project; while A is active, open a historical conversation from B.
- **Actual:** the history list covers the project, but `openChat` calls `handleResume(session)` without a target worktree. The resolver chooses `args.targetWorktreeId ?? args.activeWorktreeId`, rather than resolving the transcript's original worktree.
- **Impact:** the conversation may resume against different branch/files, contrary to the history component's own stated behavior. Supersession is also scheduled against A.
- **Sources:** [CodevChatHistorySection.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevChatHistorySection.tsx), lines 122–135 and 162–181; [ai-vault-session-launch-actions.ts](packages/ide/src/renderer/src/components/right-sidebar/ai-vault-session-launch-actions.ts), lines 94–121 and 240–271.
- **Acceptance:** map the history entry to its original existing checkout. If unavailable, visibly ask for a target rather than silently substituting the active checkout.

### WUI-06 — Step in cannot reliably select the agent you clicked

**P2 · Source**

- **Trigger:** two agents share one worktree; click Step in on the inactive tab's card.
- **Actual:** `handleStepIn` activates only `agent.worktreeId` and never resolves the chosen agent's tab. If the agent has no worktree ID, the button labeled “Open the chat tab” only displays a toast instructing the user to open it themselves.
- **Impact:** users stay on or land in another agent's conversation and cannot reliably steer the intended one.
- **Source:** [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 373–388; [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 528–530.
- **Acceptance:** activate the specific tab and pane; provide an explicit unavailable state if that target no longer exists.

### WUI-07 — The displayed denominator conflates agents with worktree capacity

**P2 · Browser + source**

- **Observed:** the blank workspace shows two local chat cards and “2 of 3 agents live”.
- **Actual:** the panel publishes `agents.length` to the parent, while the stop implementation explicitly documents that capacity counts worktrees. Mission Control renders `/ Math.max(agents.length, 3)`; the parent retains the configured maximum of three.
- **Impact:** several tabs sharing one checkout appear to exhaust capacity. With four cards, the panel can show `4 / 4` while the parent describes four of three, without any capacity change.
- **Sources:** [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 342–355 and 433–439; [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 678–680; [orca-workspace.tsx](apps/web/components/orca-workspace.tsx), lines 714–727.
- **Acceptance:** present agent count and occupied worktree slots as distinct values, with the real configured capacity as denominator.

### WUI-08 — Stop confirmation promises a slot release even when none occurs

**P2 · Browser + source**

- **Reproduction:** open the local Codex agent detail and click Stop agent once, without confirming.
- **Observed:** “Stop and free the slot” and “Ends this agent and releases its slot. The branch it worked on is kept.”
- **Actual:** valid stop plans include closing a tab while preserving the root/shared worktree. Those plans cannot release that worktree slot.
- **Sources:** [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 537–572; [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 433–475.
- **Acceptance:** derive the confirmation from the actual stop plan and explicitly state whether the checkout and capacity remain occupied.

### WUI-09 — Stop and Pause do not track pending operations

**P2 · Source**

- **Trigger:** stop or pause a managed agent on a slow connection.
- **Actual:** drawer `busy` is only `steerBusy`. Neither `handlePause` nor `handleStop` sets an operation-specific pending flag; confirming Stop immediately returns the UI to its original button while the request continues.
- **Impact:** repeated requests and contradictory actions are possible, without progress feedback.
- **Sources:** [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 414–497 and 513; [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 533–545 and 740–744.
- **Acceptance:** disable conflicting actions per agent while the lifecycle request is pending; show its progress and allow a deliberate retry after failure.

### WUI-10 — A failed steer request loses its draft

**P2 · Source**

- **Trigger:** type a custom steering instruction, then submit while the request fails.
- **Actual:** drawer `submit` invokes the void callback and immediately clears the draft. The container catches failure and emits a toast but cannot restore the text.
- **Sources:** [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 486–491; [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 391–409.
- **Acceptance:** retain the instruction until acknowledged, or restore it on error without overwriting anything typed subsequently.

### WUI-11 — Agent detail is modal visually but not for keyboard interaction

**P1 · Browser + source**

- **Reproduction:** click a Mission Control card, then press Tab.
- **Observed:** focus remains on the obscured originating card after opening. Tab moves to the underlying Step in button, outside the visible dialog.
- **Actual:** a plain `aside` uses `role="dialog"` and `aria-modal="true"`, but there is no initial focus, focus trap, background inertness or focus restoration. Its effect only handles Escape.
- **Source:** [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 453–496.
- **Acceptance:** use the existing accessible dialog primitive or equivalent tested focus management; background actions must not be reachable while the drawer is modal.

### WUI-12 — File claims leak between agents sharing a worktree

**P2 · Executed + source**

- **Trigger:** managed sessions A and B share worktree W; A owns a file claim.
- **Actual:** if a claim does not match B's session, matching W still attaches it to B.
- **Executed evidence:** one `a.ts` claim with `sessionId: 'a'` is returned in both A's and B's `holds` arrays.
- **Impact:** the UI assigns ownership to the wrong agent and undermines conflict interpretation.
- **Source:** [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 162–179.
- **Acceptance:** session ID must be authoritative when present. Use checkout/branch fallback only where session identity is genuinely absent and make ambiguity visible.

### WUI-13 — Failed polling leaves stale agents and holds labeled live

**P2 · Source**

- **Trigger:** workboard or coordination polling repeatedly fails after one successful snapshot.
- **Actual:** both catches preserve previous data without an error, stale marker, last-updated time, or user-visible retry control.
- **Impact:** terminated agents and expired claims can continue appearing current; users cannot distinguish a quiet workspace from disconnected monitoring.
- **Source:** [CodevLiveAgentsPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.tsx), lines 269–335.
- **Acceptance:** preserve useful data but display freshness/reconnection state and an actionable recovery path.

## Channel messaging and collaboration

### WUI-14 — Switching channels destroys an unsent draft

**P2 · Browser + source**

- **Reproduction:** type `Unsent UI audit draft` in general; click standup; return to general.
- **Observed:** the composer is empty and Send is disabled. The draft was never submitted.
- **Cause:** `ChannelPaneBody` is keyed by channel ID and owns the draft only in local component state. Closing and reopening the channel similarly unmounts it.
- **Source:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 40–54.
- **Acceptance:** preserve drafts per workspace/channel across channel switches and Back to chat.

### WUI-15 — Channel send failure loses the message body

**P1 · Source**

- **Trigger:** submit a channel message when the backend rejects the request or the connection fails.
- **Actual:** `setDraft('')` executes before the request. The catch sets only `notice`, leaving the text gone.
- **Source:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 116–142.
- **Acceptance:** preserve a recoverable failed message or restore the draft, with a retry affordance that does not duplicate a message already accepted by the server.

### WUI-16 — The channel overlay exposes the obscured agent chat to keyboard users

**P1 · Browser + source**

- **Reproduction:** open general, focus its empty composer, then Tab through Ask the agent.
- **Observed:** the next focus target is the underlying agent surface's Back to chat button. The accessibility tree also retains the underlying Terminal input, agent composer, attachment control and provider menus.
- **Cause:** the channel is an absolutely positioned layer while the agent chat remains mounted without an inert/hidden accessibility boundary.
- **Source:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 24–38 and 156–160; verify the containing chat layer when fixing.
- **Acceptance:** preserve the running chat's mounted state while removing its obscured interactive content from tab order and the accessibility tree. Restore focus when the channel closes.

### WUI-17 — Transcript loading failure masquerades as a new empty channel

**P2 · Source**

- **Trigger:** the first `team.messages` load fails.
- **Actual:** the catch ignores the error and the UI renders “This is the start of #…”. There is no distinct initial loading state. A successful transcript poll also clears the error used for channel-metadata failures.
- **Impact:** users may think history is gone or that a channel is new when its data has simply failed to load.
- **Source:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 58–101 and 187–194.
- **Acceptance:** separate metadata, initial loading, empty, stale and failed transcript states; do not let one successful request erase another request's error.

### WUI-18 — Older channel history cannot be reached

**P2 · Source**

- **Trigger:** a channel contains more than 60 messages.
- **Actual:** the server defaults to the latest 60. The bridge requests the messages endpoint without a `before` cursor, and the channel UI only replaces that page. No pagination control or scroll-to-load handler exists.
- **Impact:** earlier conversation is inaccessible through this workspace UI, despite backend cursor support.
- **Sources:** [team-chat.ts](apps/web/lib/team-chat.ts), lines 29 and 255–285; [messages route](apps/web/app/api/workspaces/[workspaceId]/channels/[channelId]/messages/route.ts), lines 30–42; [codev-parent-bridge.ts](apps/web/components/codev-parent-bridge.ts), lines 1124–1136; [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 80–101.
- **Acceptance:** add older-message pagination with stable ordering and preserved scroll position.

### WUI-19 — Incoming messages interrupt reading older content

**P2 · Source**

- **Trigger:** scroll upward while the channel has fewer than a full page of messages; another message arrives.
- **Actual:** any change to message count or group count unconditionally sets `scrollTop = scrollHeight`.
- **Source:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 109–114.
- **Acceptance:** follow new messages only when the reader is already near the bottom or has just sent one; otherwise show an unread/new-message affordance.

### WUI-20 — Poll/send races can duplicate or temporarily erase channel messages

**P2 · Source; timing-dependent**

- **Trigger A:** a poll includes a just-sent message before the send response returns. The send callback blindly appends the same message again.
- **Trigger B:** a poll began before a send but returns afterward. Its unconditional `setMessages` can remove the locally acknowledged message until the next poll.
- **Actual:** messages are replaced by polls and appended by sends without ID deduplication or response ordering. Polls can also overlap each other.
- **Source:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 80–96 and 124–129.
- **Acceptance:** reconcile by durable message ID, reject stale responses, and serialize or cancel overlapping reads. Cover both response orders.

### WUI-21 — Enter can submit while the user is composing text with an IME

**P2 · Source**

- **Trigger:** use a Chinese/Japanese/Korean input method and press Enter to commit a candidate in a channel composer or steering input.
- **Actual:** Enter triggers submission without checking composition state.
- **Sources:** [CodevChannelPane.tsx](packages/ide/src/renderer/src/components/codev/CodevChannelPane.tsx), lines 144–148; [CodevMissionControlView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevMissionControlView.tsx), lines 597–601.
- **Acceptance:** ignore submit shortcuts during composition; test composition commit separately from intentional Enter submission.

### WUI-22 — Team status save failure has no visible error

**P2 · Source**

- **Trigger:** edit your status and submit when `team.saveStatus` rejects.
- **Actual:** `StatusComposer.submit` has `try/finally` but no catch. The parent callback also does not catch. Saving stops, but no failure explanation appears.
- **Source:** [CodevTeamPanel.tsx](packages/ide/src/renderer/src/components/sidebar/CodevTeamPanel.tsx), lines 74–82 and 267–273.
- **Acceptance:** retain the entered status and show an inline failure with retry; avoid an unhandled rejected event-handler promise.

## Explorer, review, activity and recovery

### WUI-23 — Explorer claims are wired to default slots and paths

**P2 · Browser + source**

- **Observed:** an empty blank workspace with two local agents displays “Agent slot 1 must claim README.md before a write is allowed,” “No active path claim · agent write is blocked,” and disabled claim controls.
- **Actual:** claim creation chooses the first occupied managed slot (second for overlap) and passes no path. The view defaults to `README.md`; the backend defines the same default. No active-file or agent selector is wired to these controls.
- **Impact:** the interface appears to describe the current file/agent's write permission but actually addresses a default managed-session scenario. Local-only users get an unexplained disabled workflow.
- **Sources:** [CodevPathClaimsPanel.tsx](packages/ide/src/renderer/src/components/sidebar/CodevPathClaimsPanel.tsx), lines 74–101; [CodevPathClaimsView.tsx](packages/ide/src/renderer/src/components/sidebar/CodevPathClaimsView.tsx), lines 82–113 and 147–163; [path-claims-view.ts](apps/web/lib/path-claims-view.ts), `DEFAULT_CLAIM_PATH`.
- **Acceptance:** make the path and agent explicit, honor the selected file, and describe managed-only limitations instead of issuing a global “write is blocked” statement.

### WUI-24 — Activity jumps switch panels without opening the event target

**P2 · Source**

- **Trigger:** use an activity event's file/session jump action.
- **Actual:** the handler only calls `setRightSidebarTab(event.jump.surface)`; it ignores `event.jump.path` and `event.jump.sessionId`.
- **Impact:** the requested file, session or diff is not selected, so the user must locate it again manually.
- **Sources:** [CodevActivityAuditPanel.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevActivityAuditPanel.tsx), lines 53–62; [CodevActivityAuditView.tsx](packages/ide/src/renderer/src/components/right-sidebar/CodevActivityAuditView.tsx), lines 6–12 and 155–165.
- **Acceptance:** navigate to the target entity as well as the surface; show a meaningful unavailable state if it was removed.

### WUI-25 — Persistent connection errors remain an indefinite starting screen

**P2 · Source; earlier session observation is supporting context only**

- **Trigger:** `/orca` repeatedly returns a non-actionable failure, malformed successful payload, or a persistent infrastructure error.
- **Actual:** all statuses outside 401/403/404/429 are retried through `host-starting`; payload errors are discarded. The 90-second threshold changes the copy but does not surface the actual failure. A fetch that never settles has no explicit client timeout.
- **Impact:** an unrecoverable failure looks like a normal cold start. Users cannot tell whether waiting will help or report a useful failure reason.
- **Sources:** [orca-workspace.tsx](apps/web/components/orca-workspace.tsx), lines 59–74 and 1147–1235; [CodevAwaitingWorkspaceCover.tsx](packages/ide/src/renderer/src/components/codev/CodevAwaitingWorkspaceCover.tsx), host-starting branch.
- **Context:** the earlier workspace in this conversation stayed on a startup message during observation. That alone does not prove its underlying cause or a permanently stuck host. The current blank workspace did load.
- **Acceptance:** retain automatic retry for genuine startup responses, but show bounded failure escalation, last meaningful error and manual recovery for persistent failures; bound individual requests.

### WUI-26 — Review checkpoint selection can target an unrelated worktree

**P1 · Executed + source**

- **Trigger:** the active worktree has no matching checkpoint while another worktree does.
- **Actual:** `selectCodevReviewCheckpoint` falls back to the last prepared checkpoint, or an unprepared one, even when a non-null requested worktree did not match. Prepare/Merge callbacks then use that returned checkpoint's session ID.
- **Executed evidence:** requested worktree `selected`, available prepared checkpoint `{worktreeId:'other',sessionId:'other-session'}` → returns that unrelated checkpoint.
- **Impact:** controls inside the active checkout's Source Control can act on a different proposal. The assignment text helps, but there is no explicit cross-worktree selection step.
- **Sources:** [CodevReviewCheckpointView.tsx](packages/ide/src/renderer/src/components/sidebar/CodevReviewCheckpointView.tsx), lines 66–82; [CodevReviewCheckpointPanel.tsx](packages/ide/src/renderer/src/components/sidebar/CodevReviewCheckpointPanel.tsx), lines 29–31, 67 and 84–120.
- **Acceptance:** an explicit worktree without a match produces an empty state. Any workspace-wide fallback must require a visible, deliberate checkpoint selection.

### WUI-27 — Creating a channel does not lock the pending submission

**P2 · Source**

- **Trigger:** double-click Create or press Enter repeatedly while channel creation is pending.
- **Actual:** `handleCreateChannel` has no creating flag or guard, and Create remains enabled. Multiple requests can race; one may succeed while another sets a duplicate-name error.
- **Source:** [CodevTeamPanel.tsx](packages/ide/src/renderer/src/components/sidebar/CodevTeamPanel.tsx), lines 242–265 and 379–408.
- **Acceptance:** serialize creation, show pending state, and ensure stale failure responses cannot overwrite a successful creation.

## Additional observations requiring follow-up

These are not included in the 27 confirmed/source-backed findings above.

- **Settings navigation:** clicking the sidebar Settings control during the audit did not visibly change the page in subsequent snapshots and no new browser tab appeared. The source dispatches `openSettingsPage`; the cause was not isolated. Check whether embedded view synchronization or lazy loading cancels the navigation before calling this a confirmed product defect.
- **Presence inconsistency:** the connected current viewer was shown alongside “Team 0 here,” while Mission Control showed “1 person steering.” The latter is derived from agent owner names, not live human presence. Verify heartbeat/presence semantics with a second session before treating this as a server presence bug.
- **Light theme:** `orca-theme-overrides.css` assigns dark surfaces at `:root` as well as `html.dark`, and the drawer uses a fixed dark background. Verify the intended product theme policy and exposed settings; light-mode behavior was not exercised, so this is not a verified light-mode failure.
- **Contrast and target size:** the team rail uses multiple 10–11px labels at 35–45% foreground opacity; the agent drawer close control is 24px square. These deserve measured light/dark and touch review. A 24px web target is not automatically a WCAG AA failure, and native 44pt requirements should not be misreported as web criteria.
- **History empty state:** the blank workspace displayed an existing `hi` bubble but “No earlier chats in this project yet.” This may be an unpersisted/current conversation; transcript persistence and folder-project scoping need a controlled completed-turn test.
- **Earlier local HTTP 500:** restarting the old development server resolved missing Next runtime-module errors in the preceding task. Treat this as an observed development environment failure, not proof that deployed workspace routing is broken.

## Coverage and limits

| Area                  | What was checked                                                                              | What remains                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Workspace shell       | Current blank workspace opened; sidebar navigation, parent capacity display                   | Fresh Git workspace lifecycle and reconnect failure injection                                                            |
| Mission Control       | Cards, detail, keyboard traversal, first stop confirmation; source identity/count/claim logic | Actual agent termination, concurrent managed agents, multi-member permissions                                            |
| Channel chat          | general/standup navigation, unsent draft switch, keyboard traversal; send/poll code           | Real send failures, long populated transcript, concurrent messages, IME device test                                      |
| Sharing               | Opened share dialog; member and invite-role UI loaded; close/Tab behavior inspected           | Creating/revoking invites and different roles                                                                            |
| Explorer              | Blank-workspace explorer and claim UI loaded                                                  | File mutations, large trees, search results and external edits                                                           |
| Source Control/review | Blank workspace correctly stated Git-only source control; checkpoint source inspected         | Actual diff review and merge, Git conflicts, cross-worktree E2E scenario                                                 |
| Activity              | Panel and filter controls opened; jump handler inspected                                      | Populated event target navigation                                                                                        |
| Settings              | Attempted entry and inspected navigation handler                                              | Full provider/settings flow and theme switching                                                                          |
| Accessibility/layout  | Desktop dark appearance, modal focus and channel overlay focus; design guidance reviewed      | 375px/mobile, landscape, browser zoom, measured contrast in both themes, screen reader and reduced-motion runtime checks |

No mobile, light-mode, full screen-reader, multi-user or destructive end-to-end coverage is claimed. No production deployment was audited in this pass. The scope emphasizes CoDev's workspace surfaces, not every upstream Orca feature.

## Verification performed

1. Read the repository guidance and the vendored Apple Design/UI-UX skills. Applied their keyboard, feedback and recovery criteria; no visual redesign was performed.
2. Inspected the live local workspace through Chrome screenshots and accessibility/DOM snapshots. Reproduced WUI-11, WUI-14 and WUI-16 with non-destructive interaction, and observed the UI statements referenced by WUI-07, WUI-08 and WUI-23.
3. Ran in-memory reproductions against actual TypeScript functions for WUI-01, WUI-02, WUI-03, WUI-12 and WUI-26. The source was transpiled in memory, not copied into replacement implementations.
4. Ran the existing focused IDE tests:

   ```sh
   bash scripts/ide.sh exec vitest run --config config/vitest.config.ts \
     src/renderer/src/web/codev-agent-stop-plan.test.ts \
     src/renderer/src/components/right-sidebar/CodevMissionControlView.test.tsx \
     src/renderer/src/components/right-sidebar/CodevLiveAgentsPanel.test.ts
   ```

   Result: **3 test files, 37 tests passed**. Passing tests do not cover the failing fallback-ID and lifecycle combinations identified above. Browser event sequencing is also not established by static markup tests.

## Suggested remediation order

1. Correct agent identity and lifecycle targeting: WUI-01–06. Add integrated tests spanning fallback rows, shared worktrees, history replacement and the actual store close guard.
2. Correct review targeting and ownership attribution: WUI-26 and WUI-12.
3. Prevent draft loss and hidden-surface interaction: WUI-10–11 and WUI-14–16.
4. Make counts, stop outcomes and pending/error feedback truthful: WUI-07–09, WUI-13, WUI-17, WUI-22, WUI-25 and WUI-27.
5. Complete channel history, ordering and navigation: WUI-18–21, WUI-23–24.
6. Run the unverified coverage matrix with controlled test accounts and disposable workspaces before declaring the workspace UI stable.
