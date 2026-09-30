# Collaborative IDE screenshot evidence

Browser verification screenshots use one stable layout:

```text
artifacts/verification/<task-id>/<visible-state>.png
```

The Playwright helper at
`apps/web/tests/e2e/support/evidence.ts` is the single capture convention.
Call `captureVerificationScreenshot(page, testInfo, { taskId, state })` after
the visible assertions for a flow pass. The helper lowercases and sanitizes
the task and state names, captures the full page, and attaches the PNG to the
Playwright test report.

Use a short state name that describes what the screenshot proves, such as
`fixture-ready`, `invite-expired`, or `role-viewer`. Each task should capture
its final success state and, when the flow has a meaningful failure or recovery
state, one edge-state screenshot as well.

Run the focused flow from `apps/web`:

```bash
pnpm exec playwright test tests/e2e/verification-fixture.spec.ts
```

The generated path is printed or recorded with the task's validation evidence;
the screenshot itself is local verification output and is not a secret or a
production deployment artifact.
