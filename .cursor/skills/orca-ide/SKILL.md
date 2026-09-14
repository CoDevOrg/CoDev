---
name: orca-ide
description: Use when editing packages/ide (Orca fork), the embedded browser IDE, `orca serve`, or `apps/web/public/orca`. Activate for pnpm orca:web, IDE bundle regeneration, or when root workspace commands must exclude this package.
---

# Orca (`packages/ide`)

- Own package manager / scripts. Not in root pnpm workspace.
- Do not format with root Prettier or include in root recursive commands.
- Embedded web IDE source changes: `pnpm orca:web` and commit `apps/web/public/orca/**` with the source change.
- `pnpm orca:web` is ~90s and ends by mirroring `out/web` into
  `apps/web/public/orca`. Batch IDE edits and rebuild once, at the end.
- Verify the copy happened: the script only prints
  `CoDev IDE web client ready at ...` on success. It used to die at `rsync`,
  which Git Bash on Windows does not have, leaving a stale bundle that looked
  regenerated. Never pipe the build through `tail` — that masks its exit code.
- Test narrowly while iterating:
  `vitest run --config config/vitest.config.ts src/renderer/src/<area>`.
  A full run over this package is several minutes.
- The pre-commit hook lints staged files, so pre-existing `oxlint` violations in
  a file you touch block your commit. `max-lines` disables are forbidden — if a
  file is already over the cap, put your change in a different seam.
- Import heavy or side-effecting libraries lazily inside the branch that needs
  them: a module-scope import in `components/native-chat` or
  `components/terminal-pane` can shift listener-count baselines and break
  unrelated retention tests.
