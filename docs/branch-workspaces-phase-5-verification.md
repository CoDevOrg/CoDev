# Branch Workspaces — Phase 5 Verification

**Status:** Local and public-production verification complete; authenticated three-agent verification is blocked by workspace compute credits
**Date:** 2026-09-17
**Scope:** Branches-first navigation, branch context, agent visibility, terminal disclosure, status reconciliation, and rollout readiness

## Result

The branches-first flow is verified locally and on the public production alias across the web application, the embedded Orca client, focused component tests, and browser tests. The deployed bundle opens on **Branches**, keeps the raw terminal out of the first surface, preserves the direct branch route during bootstrap, and exposes terminal access only from a selected branch workspace.

The production three-agent demonstration has not been signed off because the authenticated workspace currently reports that its monthly compute credit is used up. The product supplied a clear recovery message, but starting agents is not possible until the credit resets or another workspace member frees capacity.

## Evidence matrix

| Acceptance area                              | Local evidence                                                                         | Result                    | Production gate                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------ |
| New workspace opens to Branches              | `workspace-shell.spec.ts`: pending workspace surface                                   | Pass                      | Re-run after deploy                  |
| Public production alias serves the new shell | Same 4-test browser suite against `https://www.trycodev.com`                           | Pass                      | Complete                             |
| Terminal is secondary                        | Branches browser test, `CodevChatFirstCover` tests, terminal drawer event tests        | Pass locally              | Re-run after deploy                  |
| Branch row context                           | `CodevBranchCard.test.tsx`, `codev-branches-model.test.ts`                             | Pass                      | Live branch data pending             |
| Branch entry and context header              | `CodevBranchWorkspaceHeader.test.tsx`, branch activation path                          | Pass locally              | Re-run with a real branch            |
| Agent/provider/status mapping                | `codev-status-model.test.ts`, `codev-branches-model.test.ts`, branch-card failure test | Pass                      | Re-run with real providers           |
| Refresh-race and contradictory counts        | status reconciliation tests                                                            | Pass                      | Re-run during live refresh           |
| Provider failure and recovery copy           | status model and branch-card unavailable-provider tests                                | Pass                      | Re-run with a revoked connection     |
| Direct branch URL                            | bootstrap browser test plus `orca-workspace` and bootstrap unit tests                  | Pass locally              | Re-run with a real branch URL        |
| Keyboard/focus and accessible naming         | semantic roles, labels, focus assertions, component tests                              | Pass for covered surfaces | Complete viewport/screen-reader pass |
| Light/dark and reduced motion                | `workspace-shell.spec.ts` in both themes with reduced motion                           | Pass                      | Re-run after deploy                  |
| Three agents on three isolated branches      | Authenticated workspace blocked by exhausted monthly compute credit                    | Blocked externally        | Required before final sign-off       |

## Automated verification run

The following checks passed during this phase or were already passed after the Phase 4 implementation:

- `pnpm typecheck`
- `pnpm test` — 814 passed, 1 skipped
- `pnpm lint` — passed with three existing warnings
- `pnpm build`
- `pnpm --filter @codev/web exec playwright test tests/e2e/workspace-shell.spec.ts` — 4 passed
- `pnpm test:e2e` — 38 passed, 1 skipped
- Production alias browser smoke — 4 passed against `https://www.trycodev.com`
- Focused Orca suite — 4 files, 20 tests passed
- `pnpm typecheck:web`
- Targeted Oxlint/Oxfmt and `git diff --check`
- `pnpm orca:web` — bundle verifier passed and regenerated the embedded Orca output

The full `packages/ide` suite still has unrelated baseline failures in missing fixtures and environment-dependent integration tests. The directly affected Phase 4/5 tests pass; the baseline failures are recorded in the handoff rather than being treated as rollout evidence.

The repository-wide `pnpm format:check` also remains blocked only by the pre-existing `.claude/settings.local.json` formatting mismatch.

## Local browser observations

The rebuilt embedded client was opened locally in Chromium with the pending CoDev workspace fragment. The accessible surface showed:

- `Branches` as the primary heading
- the branch workspace description
- a disconnected/retry state when no local bridge was present
- no terminal surface on the landing view
- reduced-motion behavior with animated loading disabled

The browser suite additionally verified that the `codevBranch` fragment survives web-client bootstrap as `feature/chat-first`.

## Production rollout gate

Before calling Phase 5 complete:

- [x] Commit the local implementation and generated Orca bundle.
- [x] Push the commit to `main` and wait for the Deploy web workflow and production deployment to succeed.
- [x] Verify the public production alias serves the branches-first shell.
- [ ] Open an authenticated production workspace using the deployed revision. **Blocked:** the workspace reports that its monthly compute credit is used up.
- [ ] Start three agents on three distinct branches/worktrees.
- [ ] Confirm each branch shows the correct owner, provider, agent, status, code context, and changed files.
- [ ] Enter each agent from its branch without a blank view or unrelated worktree.
- [ ] Exercise provider-disconnected, reconnecting, provisioning, and refresh-race states.
- [ ] Check desktop and narrow responsive layouts in light and dark themes, keyboard focus, accessible names, and reduced motion.
- [ ] Capture the production evidence and mark this report complete.

No new feature flag was added: local behavior is intentionally branches-first by default. If the production three-agent run finds a migration issue, pause rollout through the deployment rollback path before enabling more workspaces.
