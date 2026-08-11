# Collaborative IDE Task State

This is the persistent state for the two-hour scheduler. A scheduler run may
work on **only the Current task**. It must update this file only after the task
has passed its required tests, Computer Use flow, and screenshots.

## Current task

**F1.1 — Define/validate Viewer, Collaborator, and Maintainer capabilities**

Read the F1.1 card in `COLLABORATIVE_IDE_EXECUTION.md`. Do not work on F1.2 or
any later task during the same scheduler run.

## Completed tasks

| Task                                                            | Completed  | Evidence                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0.1 — Baseline audit                                           | 2026-08-11 | [Baseline audit](./COLLABORATIVE_IDE_BASELINE_AUDIT.md) — 22 focused tests passed; Computer Use production check captured the workspace-open failure.                             |
| B0.2 — Stable local verification fixture and fixture identities | 2026-08-11 | [B0.2 fixture documentation](./COLLABORATIVE_IDE_FIXTURES.md) — focused checks, pushed source commit, Vercel preview, and Computer Use screenshots recorded below.                |
| B0.3 — Reusable screenshot/evidence convention                  | 2026-08-11 | [Screenshot evidence convention](./COLLABORATIVE_IDE_EVIDENCE.md) — focused Playwright capture, pushed source commit, Vercel preview, and Computer Use screenshot recorded below. |

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
