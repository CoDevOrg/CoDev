# Orca upstream

- Repository: https://github.com/stablyai/orca
- License: MIT
- Reference commit: `6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc`
- Reference version: `v1.4.177-rc.0`

CoDev's hosted Orca workspace forks Orca's renderer chrome and runtime
vocabulary. The adapted `SidebarNav`, `SidebarHeader`, agent-state indicator,
titlebar, worktree cards, inspector, theme tokens, and pane composition live
under `apps/web/components/orca/` and the Orca section of `globals.css`.

The `orca-runtime-adapter.ts` module replaces Orca's Electron preload and
pairing transport with CoDev's authenticated Firecracker APIs. This keeps the
product browser-hosted and prevents guest ports, pairing tokens, or provider
credentials from being exposed publicly.
