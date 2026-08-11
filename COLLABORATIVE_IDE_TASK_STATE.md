# Collaborative IDE Task State

This is the persistent state for the two-hour scheduler. A scheduler run may
work on **only the Current task**. It must update this file only after the task
has passed its required tests, Computer Use flow, and screenshots.

## Current task

**B0.3 — Reusable screenshot/evidence convention**

Read the B0.3 card in `COLLABORATIVE_IDE_EXECUTION.md`. Do not work on B0.4 or
any later task during the same scheduler run.

## Completed tasks

| Task                                                            | Completed  | Evidence                                                                                                                                                           |
| --------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B0.1 — Baseline audit                                           | 2026-08-11 | [Baseline audit](./COLLABORATIVE_IDE_BASELINE_AUDIT.md) — 22 focused tests passed; Computer Use production check captured the workspace-open failure.              |
| B0.2 — Stable local verification fixture and fixture identities | 2026-08-11 | [B0.2 fixture documentation](./COLLABORATIVE_IDE_FIXTURES.md) — focused checks, pushed source commit, Vercel preview, and Computer Use screenshots recorded below. |

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
