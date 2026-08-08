# Orca workspace architecture

CoDev uses an Orca-based, agent-first browser IDE instead of Eclipse Theia.
The implementation follows Orca's open-source web workspace model while
preserving CoDev's hosted control plane and Firecracker isolation boundary.

## Runtime split

- The workspace shell, Monaco editor, xterm terminal, worktree reviews, and
  agent surfaces run in the browser.
- Files, Git operations, terminals, previews, and agent worktrees are served
  through authenticated CoDev workspace APIs.
- The Firecracker guest runs only `codev-guestd` beside `/workspace`; it does
  not expose an IDE port or receive provider credentials.
- Yjs collaboration remains on CoDev's WebSocket service and Postgres-backed
  document store.

## Why CoDev does not run `orca serve` directly

Upstream Orca's web client pairs with a long-running Electron-based runtime
over its own encrypted WebSocket protocol. CoDev already has permission-aware
workspace APIs, durable agent state, collaboration rooms, and an isolated
guest protocol. Reusing those boundaries avoids a second identity system and
keeps Vercel, AWS, and guest credentials separated.

## Upstream tracking

The initial adaptation is based on Orca commit
`fc8441194ce400ad3a6dfdc053d163a9f9688a33` (`v1.4.176`). The upstream MIT
license and reference metadata are retained under `third_party/orca/`.
