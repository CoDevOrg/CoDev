# Collaborative IDE Task State

This is the persistent state for the two-hour scheduler. A scheduler run may
work on **only the Current task**. It must update this file only after the task
has passed its required tests, Computer Use flow, and screenshots.

## Current task

**B0.2 — Stable local verification fixture and fixture identities**

Read the B0.2 card in `COLLABORATIVE_IDE_EXECUTION.md`. Do not work on B0.3 or
any later task during the same scheduler run.

## Completed tasks

| Task | Completed | Evidence |
| --- | --- | --- |
| B0.1 — Baseline audit | 2026-08-11 | [Baseline audit](./COLLABORATIVE_IDE_BASELINE_AUDIT.md) — 22 focused tests passed; Computer Use production check captured the workspace-open failure. |

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
