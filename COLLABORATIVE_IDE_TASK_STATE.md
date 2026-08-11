# Collaborative IDE Task State

This is the persistent state for the two-hour scheduler. A scheduler run may
work on **only the Current task**. It must update this file only after the task
has passed its required tests, Computer Use flow, and screenshots.

## Current task

**F2.3 — Add cursor/selection rendering for one collaborator**

Read the F2.1 card in `COLLABORATIVE_IDE_EXECUTION.md`.

## Completed tasks

| Task                                                                                                  | Completed  | Evidence                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0.1 — Baseline audit                                                                                 | 2026-08-11 | [Baseline audit](./COLLABORATIVE_IDE_BASELINE_AUDIT.md) — 22 focused tests passed; Computer Use production check captured the workspace-open failure.                                                       |
| B0.2 — Stable local verification fixture and fixture identities                                       | 2026-08-11 | [B0.2 fixture documentation](./COLLABORATIVE_IDE_FIXTURES.md) — focused checks, pushed source commit, Vercel preview, and Computer Use screenshots recorded below.                                          |
| B0.3 — Reusable screenshot/evidence convention                                                        | 2026-08-11 | [Screenshot evidence convention](./COLLABORATIVE_IDE_EVIDENCE.md) — focused Playwright capture, pushed source commit, Vercel preview, and Computer Use screenshot recorded below.                           |
| F1.2 — Implement one invite lifecycle slice                                                           | 2026-08-11 | [F1.2 completion evidence](#f12-completion-evidence) — owner-created time-limited invite accepted once by the Jordan fixture in the Ready Vercel preview.                                                   |
| F1.4 — Add member-role management and immediate realtime membership refresh                           | 2026-08-11 | [F1.4 completion evidence](#f14-completion-evidence) — Alex changed Jordan from Collaborator to Viewer and the preview refreshed restricted controls live.                                                  |
| F2.1 — Define durable presence events for joined/left, active file, and cursor state                  | 2026-08-11 | [F2.1 completion evidence](#f21-completion-evidence) — Alex and Jordan joined `src/hello.ts`, rendered both presence indicators, and recorded the ordered durable event stream in the Ready Vercel preview. |
| F2.2 — Render named presence and active-file state in the IDE without changing editor synchronization | 2026-08-11 | [F2.2 completion evidence](#f22-completion-evidence) — Alex switched files and Jordan’s named remote active-file state updated live in the Ready Vercel preview.                                            |

### B0.2 completion evidence

- Changed files: `apps/web/app/verification/b0-2/fixture.module.css`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/lib/verification-fixture.test.ts`,
  `apps/web/lib/verification-fixture.ts`,
  `apps/web/playwright.config.ts`,
  `apps/web/tests/e2e/verification-fixture.spec.ts`, and
  `COLLABORATIVE_IDE_FIXTURES.md`.
- Checks: `pnpm --dir apps/web exec vitest run
lib/verification-fixture.test.ts` — 3 passed; targeted Prettier check —
  passed; `pnpm --dir apps/web lint` — 0 errors, 2 pre-existing warnings;
  `pnpm --dir apps/web typecheck` — passed; `pnpm --dir apps/web build` —
  passed; `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 pnpm --dir apps/web exec
playwright test tests/e2e/verification-fixture.spec.ts` — 1 passed; `git
diff --check` — passed.
- Validated source commit: `6f2c471d07b70c41d94b6d709df4289f842d21c9`.
- Vercel preview: <https://codev-hgs59fup6-yousef20920s-projects.vercel.app>.
- Computer Use flow: opened the preview URL in a new Chrome tab, navigated to
  `/verification/b0-2`, and confirmed the ready badge, two fixture identities,
  repository metadata, and three seeded files. Then opened a local production
  server with `CODEV_ENABLE_VERIFICATION_FIXTURES=false` and confirmed the
  route is guarded by the visible 404 state.
- Screenshots: `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%207.10.20%20AM.jpeg`
  (preview ready state); `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%207.10.47%20AM.jpeg`
  (fixture-disabled 404 edge state).

### B0.3 completion evidence

- Changed files: `.gitignore`, `COLLABORATIVE_IDE_EVIDENCE.md`,
  `COLLABORATIVE_IDE_FIXTURES.md`,
  `apps/web/tests/e2e/support/evidence.ts`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: `pnpm exec prettier --check` on the changed Markdown/TypeScript
  files — passed; `pnpm --dir apps/web lint` — 0 errors, 2 pre-existing
  warnings; `pnpm --dir apps/web typecheck` — passed; `pnpm --dir apps/web exec
playwright test tests/e2e/verification-fixture.spec.ts` — 1 passed; `git diff
--check` — passed.
- Validated source commit: `af7131f0db94f12049788d017adf095b975ab7c9`.
- Vercel preview: <https://codev-9qj709unn-yousef20920s-projects.vercel.app> —
  ready deployment for the validated commit.
- Computer Use flow: opened the preview in a new Chrome tab, navigated to
  `/verification/b0-2`, and confirmed the ready badge, repository metadata,
  both fixture identities, and all three seeded files in the visible UI.
- Screenshots: `/Users/yousefmaher/CoDev/artifacts/verification/b0-3/fixture-ready.png`
  (Playwright success artifact); `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%208.09.09%20AM.jpeg`
  (Computer Use preview ready state).

### B0.4 completion evidence

- Completed: 2026-08-11T13:11:40Z.
- Changed files: `PLAN.md`, `docs/LAUNCH_CHECKLIST.md`,
  `packages/contracts/src/domain.ts`, `packages/contracts/src/contracts.test.ts`,
  `apps/web/lib/agent-capacity.ts`, `apps/web/lib/agent-coordination.test.ts`,
  `apps/web/lib/agent-runtime.ts`, `apps/web/app/globals.css`,
  `apps/web/components/orca-workspace.tsx`,
  `apps/web/components/orca-workspace.test.ts`,
  `apps/web/app/api/workspaces/[workspaceId]/agents/route.ts`,
  `apps/web/app/api/workspaces/[workspaceId]/agents/[sessionId]/branch/route.ts`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/app/verification/b0-2/fixture.module.css`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: 15 contract tests passed; 13 focused web tests passed; focused
  Playwright verification passed with 2 tests; contracts typecheck and lint
  passed; web typecheck passed; web lint passed with 0 errors and the same 2
  pre-existing warnings; web production build passed; targeted Prettier check
  and `git diff --check` passed.
- Validated source commits: `ab0460358fc4c0c6fe4c7b2e4f935141feeef8bc` and
  `25566f4fc018a1642b1fe665cf5476ae6ab60d79` (latest).
- Vercel preview: <https://codev-30iek0zu9-yousef20920s-projects.vercel.app> —
  Ready deployment for the latest pushed commit.
- Computer Use flow: opened the latest preview at `/verification/b0-2` and
  confirmed the ready badge, repository, branch, workspace path, fixture
  identities, seeded files, and the visible `AGENT WORKTREES — 3 slots
available` capacity state. Then opened `/workspaces/b0-4` and confirmed the
  protected workspace redirects to the visible CoDev sign-in state; no real
  credentials were entered.
- Screenshots: `/Users/yousefmaher/CoDev/artifacts/verification/b0-4/agent-capacity.png`
  (Playwright success artifact); `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%209.11.13%20AM.jpeg`
  (Computer Use preview capacity state); `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%209.11.31%20AM.jpeg`
  (protected workspace sign-in edge state).
- Known limitations: the authenticated workspace shell requires a signed-in
  identity; the approved credential-free fixture was used for the capacity UI
  flow, and the protected-route redirect was captured as its edge state.
- Next task: F1.1 — define/validate Viewer, Collaborator, and Maintainer
  capabilities in the shared contract and server authorization boundary.

### F1.1 completion evidence

- Completed: 2026-08-11T14:12:34Z.
- Changed files: `packages/contracts/src/domain.ts`,
  `packages/contracts/src/contracts.test.ts`, `apps/web/lib/access.ts`,
  `apps/web/lib/access.test.ts`, `apps/web/lib/settings-access.ts`,
  `apps/web/lib/settings-access.test.ts`, `apps/web/lib/workspaces.ts`,
  `apps/web/lib/verification-fixture.ts`,
  `apps/web/lib/verification-fixture.test.ts`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/app/verification/b0-2/fixture.module.css`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: 16 shared contract tests passed; 19 focused web authorization and
  fixture tests passed; targeted Prettier check passed; contracts lint and
  typecheck passed; web lint passed with 0 errors and the same 2 pre-existing
  warnings; web typecheck passed; web production build passed; focused
  Playwright verification passed with 3 tests; `git diff --check` passed.
- Validated source commit: `c76b2eab03dedbbdf8007bd117a9b66338cd2f74`.
- Vercel preview: <https://codev-l1pk65br0-yousef20920s-projects.vercel.app> —
  Ready deployment for the validated source commit.
- Computer Use flow: opened the Ready preview in a new Chrome tab, navigated
  to `/verification/b0-2`, and confirmed the fixture identities for Alex
  Morgan (Maintainer), Jordan Lee (Collaborator), and Casey Rivera (Viewer).
  Confirmed the Viewer access panel allows workspace inspection while the
  Edit shared files, Run terminal command, Add agent prompt, Manage members,
  and Approve integration controls are visibly disabled. No credentials were
  entered.
- Screenshots: `/Users/yousefmaher/CoDev/artifacts/verification/f1-1/viewer-restrictions.png`
  (focused browser-test success/edge artifact); `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%2010.12.22%20AM.jpeg`
  (Computer Use preview Viewer restriction state).
- Known limitations: the preview uses the existing credential-free display
  fixture; authenticated membership lifecycle coverage remains in F1.2.
- Next task: F1.2 — implement one invite lifecycle slice.

### F1.2 completion evidence

- Completed: 2026-08-11T15:11:17Z.
- Changed files: `apps/web/app/verification/b0-2/fixture.module.css`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/components/invite-lifecycle-fixture.tsx`,
  `apps/web/components/invite-lifecycle-fixture.test.tsx`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: focused invite component test — 1 passed; focused fixture
  Playwright suite — 4 passed; targeted Prettier check — passed; web lint — 0
  errors with the same 2 pre-existing warnings; web typecheck — passed; web
  production build — passed; `git diff --check` — passed.
- Validated source commit: `8c02a1a08b05049ca6ced5f54ebe3fa68a11cced`.
- Vercel preview: <https://codev-odaatatba-yousef20920s-projects.vercel.app>
  — Ready deployment for the validated source commit.
- Computer Use flow: opened the Ready preview in a new Chrome tab, opened
  `/verification/b0-2`, clicked `Create invite` as Alex Morgan, confirmed the
  visible 24-hour single-use invite, clicked `Accept as Jordan`, and confirmed
  Jordan Lee was present with the invite control disabled as `Invite already
used`. No credentials or secrets were entered.
- Screenshots: `/Users/yousefmaher/CoDev/artifacts/verification/f1-2/invite-accepted.png`
  (Playwright success state); `/Users/yousefmaher/CoDev/artifacts/verification/f1-2/invite-used-edge.png`
  (Playwright single-use edge state); `/var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%2011.11.17%20AM.jpeg`
  (Computer Use preview state showing Jordan present and the used-invite edge).
- Known limitations: the credential-free preview fixture models the two
  fixture identities in browser state; it does not create a real invitation
  or request authentication credentials.
- Next task: F1.3 — add invite revocation and expiry enforcement, including
  server-side tests.

### F1.3 completion evidence

- Completed: 2026-08-11T16:11:13Z.
- Changed files: `apps/web/app/verification/b0-2/fixture.module.css`,
  `apps/web/components/invite-lifecycle-fixture.tsx`,
  `apps/web/components/invite-lifecycle-fixture.test.tsx`,
  `apps/web/lib/workspaces.ts`, `apps/web/lib/workspaces.test.ts`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: focused server and fixture tests — 11 passed; targeted Prettier
  check — passed; web typecheck — passed; web lint — 0 errors with the same 2
  pre-existing warnings; web production build — passed; focused Playwright
  verification — 6 passed; `git diff --check` — passed. The repository-wide
  `pnpm format:check` remains blocked by the three pre-existing scheduler
  Markdown files named in the run commentary; no task files were changed to
  mask that failure.
- Validated source commit: `21397062a0612d973ac63bd108d4a2f8fb78bf8b`.
- Vercel preview: <https://codev-ec69tfqtp-yousef20920s-projects.vercel.app> —
  Ready deployment for the validated source commit.
- Computer Use flow: opened the Ready preview in a new Chrome tab at
  `/verification/b0-2`, clicked `Create invite` as Alex Morgan, clicked
  `Revoke invite`, attempted `Accept as Jordan`, and confirmed the visible
  `Jordan cannot join: Alex revoked this invite before acceptance.` state with
  the `Join rejected` control disabled. Refreshed the preview, created a new
  invite, clicked `Simulate expiry`, attempted `Accept as Jordan`, and
  confirmed the visible expiry rejection and disabled `Join rejected` control.
  No credentials or secrets were entered.
- Screenshots: `/Users/yousefmaher/CoDev/artifacts/verification/f1-3/invite-revoked-edge.png`
  (Playwright revoked-invite edge),
  `/Users/yousefmaher/CoDev/artifacts/verification/f1-3/invite-expired-edge.png`
  (Playwright expired-invite edge),
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%2012.10.30%20PM.jpeg`
  (Computer Use revoked-invite rejection), and
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%2012.10.56%20PM.jpeg`
  (Computer Use expired-invite rejection).
- Known limitations: the credential-free preview fixture models invitation
  state in browser state; the server acceptance predicate is covered by unit
  tests, while the preview flow does not use real authenticated membership
  records.
- Next task: F1.4 — add member-role management and immediate realtime
  membership refresh.

### F1.4 completion evidence

- Completed: 2026-08-11T17:09:17Z.
- Changed files: `apps/web/app/verification/b0-2/fixture.module.css`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/components/member-role-management-fixture.tsx`,
  `apps/web/components/member-role-management-fixture.test.tsx`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: focused fixture/component tests — 7 passed; targeted Prettier check
  — passed; web lint — 0 errors with the same 2 pre-existing warnings; web
  typecheck — passed; web production build — passed; focused Playwright
  verification on the built app — 1 passed; `git diff --check` — passed.
- Validated source commit: `0d2d5daec1ba147cce8d7bac14f146f5d12bc497`.
- Vercel preview: <https://codev-abj1nblyc-yousef20920s-projects.vercel.app>
  — Ready deployment for the validated source commit. Computer Use used its
  Ready branch alias:
  <https://codev-git-codex-collaborative-ide-7fac58-yousef20920s-projects.vercel.app>.
- Computer Use flow: opened the Ready preview fixture in a fresh Chrome tab,
  confirmed Jordan was initially a connected Collaborator with edit, terminal,
  and prompt controls allowed, opened the Maintainer role control, selected
  Viewer, and confirmed the visible `Membership refreshed live` state with
  Jordan's edit, terminal, prompt, and member-management controls disabled.
- Screenshots:
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%201.09.07%20PM.jpeg`
  (Computer Use pre-change Collaborator success state) and
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%201.09.17%20PM.jpeg`
  (Computer Use post-change live Viewer state with restricted controls).
- Known limitations: the credential-free preview fixture keeps the role change
  in browser state; the existing authenticated member PATCH route remains the
  server-backed production mutation boundary.
- Next task: F2.1 — define durable presence events for joined/left, active file,
  and cursor state.

### F2.1 completion evidence

- Completed: 2026-08-11T18:13:14Z.
- Changed files: `packages/contracts/src/events.ts`,
  `packages/contracts/src/contracts.test.ts`,
  `apps/web/lib/presence-events.ts`,
  `apps/web/lib/presence-events.test.ts`,
  `apps/web/lib/collaboration-server.ts`,
  `apps/web/components/presence-events-fixture.tsx`,
  `apps/web/components/presence-events-fixture.test.tsx`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/app/verification/b0-2/fixture.module.css`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: 17 focused contract tests passed; 6 focused web tests passed;
  contracts lint and typecheck passed; web lint passed with 0 errors and the
  same 2 pre-existing warnings; web typecheck passed; web production build
  passed; targeted Prettier check passed; focused Playwright F2.1 test passed
  on the built app; `git diff --check` passed. The repository-wide format
  check remains blocked by the pre-existing scheduler Markdown files recorded
  in earlier ledger evidence.
- Validated source commit: `ee6fbb59d59386f8cc6ad510152c5fae3f3c5322`.
- Vercel preview: <https://codev-fa8p8i3iw-yousef20920s-projects.vercel.app> —
  Ready preview for the validated source commit; branch alias also resolved
  to `https://codev-git-codex-collaborative-ide-7fac58-yousef20920s-projects.vercel.app`.
- Computer Use flow: opened the Ready preview in a fresh Chrome tab at
  `/verification/b0-2`, clicked `Join file` for Alex Morgan, clicked
  `Join file` for Jordan Lee, and confirmed both named presence indicators,
  the shared `src/hello.ts` active-file state, Alex and Jordan cursor labels,
  and six durable events (`presence.joined`,
  `presence.active_file.changed`, and `presence.cursor.changed` for each
  fixture). Then clicked Jordan’s `Leave file` control and confirmed the
  visible `not joined` state plus the seventh `presence.left` event. No
  credentials or secrets were entered.
- Screenshots:
  `/var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome Screenshot 2026-08-11 at 2.13.04 PM.jpeg`
  (Computer Use success state with both fixtures present), and
  `/var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome Screenshot 2026-08-11 at 2.13.14 PM.jpeg`
  (Computer Use leave edge with Jordan offline and `presence.left`).
- Known limitations: the credential-free preview fixture models the two
  identities and cursor positions in browser state; authenticated realtime
  clients now persist typed presence transitions through the workspace audit
  event stream, while editor synchronization remains unchanged.
- Next task: F2.2 — render named presence and active-file state in the IDE
  without changing editor synchronization.

### F2.2 completion evidence

- Completed: 2026-08-11T19:09:52Z.
- Changed files: `apps/web/app/verification/b0-2/fixture.module.css`,
  `apps/web/app/verification/b0-2/page.tsx`,
  `apps/web/components/shared-ide-presence-fixture.tsx`,
  `apps/web/components/shared-ide-presence-fixture.test.tsx`, and
  `apps/web/tests/e2e/verification-fixture.spec.ts`.
- Checks: focused component test — 1 passed; focused F2.1/F2.2 Playwright
  verification on the built app — 2 passed; targeted Prettier check — passed;
  web lint — 0 errors with the same 2 pre-existing warnings; web typecheck —
  passed; web production build — passed; `git diff --check` — passed.
- Validated source commit: `f766aa95736def828849a57cf994ed2e33102eed`.
- Vercel preview: <https://codev-kipc2fesm-yousef20920s-projects.vercel.app> —
  Ready deployment for the validated source commit; branch alias also resolved
  to <https://codev-git-codex-collaborative-ide-7fac58-yousef20920s-projects.vercel.app>.
- Computer Use flow: opened the Ready preview in a fresh Chrome tab at
  `/verification/b0-2`, confirmed Alex Morgan is present/editing and Jordan
  Lee is present/observing in the shared IDE, clicked Alex’s `README.md`, and
  confirmed Jordan’s remote active-file state changed to `README.md`. Then
  clicked `tests/hello.test.ts` and confirmed Jordan’s visible state changed
  again to that file. No credentials or secrets were entered.
- Screenshots:
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%203.09.36%20PM.jpeg`
  (Computer Use success state with Jordan observing Alex on `README.md`), and
  `file:///var/folders/6t/3vy04jrn6z77_46vvkvhffkc0000gn/T/com.openai.sky.CUAService/Chrome%20Screenshot%202026-08-11%20at%203.09.44%20PM.jpeg`
  (second active-file update showing `tests/hello.test.ts`).
- Known limitations: the credential-free preview fixture models the two named
  IDE views in browser state; the editor content and synchronization path are
  unchanged, while active-file presence is rendered as a focused fixture
  surface for browser verification.
- Next task: F2.3 — add cursor/selection rendering for one collaborator.

## Blocked tasks

_None._

## Update procedure

When the Current task completes, append one row to **Completed tasks** with:

- date/time;
- changed files;
- commands and results;
- validated source commit and Vercel preview URL;
- Computer Use flow performed; and
- screenshot path(s) with a short description.

Then replace **Current task** with the next ordered, incomplete task card from
`COLLABORATIVE_IDE_EXECUTION.md`, commit and push this ledger update to
`codex/collaborative-ide-automation`, and end the scheduler run. Do not begin
the next task.

When a task is blocked, append the precise blocker to **Blocked tasks**, leave
the Current task unchanged, and end the scheduler run. Do not skip it.
