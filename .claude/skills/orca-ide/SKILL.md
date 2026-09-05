---
name: orca-ide
description: Use when editing packages/ide (Orca fork), the embedded browser IDE, `orca serve`, or `apps/web/public/orca`. Activate for pnpm orca:web, IDE bundle regeneration, or when root workspace commands must exclude this package.
---

# Orca (`packages/ide`)

- Own package manager / scripts. Not in root pnpm workspace.
- Do not format with root Prettier or include in root recursive commands.
- Embedded web IDE source changes: `pnpm orca:web` and commit `apps/web/public/orca/**` with the source change.
