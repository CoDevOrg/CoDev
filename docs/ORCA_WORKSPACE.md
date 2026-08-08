# Orca workspace architecture

CoDev forks Orca's open-source renderer into an agent-first browser IDE. The
hosted fork preserves Orca's worktree fleet, titlebar tabs, multi-pane workbench,
file inspector, agent status vocabulary, and theme while preserving CoDev's
control plane and Firecracker isolation boundary.

## Runtime split

- Orca's adapted renderer shell, Monaco editor, xterm terminal, worktree
  reviews, and agent surfaces run in the browser.
- Files, Git operations, terminals, previews, and agent worktrees are served
  through authenticated CoDev workspace APIs.
- The Firecracker guest runs only `codev-guestd` beside `/workspace`; it does
  not expose an IDE port or receive provider credentials.
- Yjs collaboration remains on CoDev's WebSocket service and Postgres-backed
  document store.

## Runtime adapter

Upstream Orca's web client normally installs a browser implementation of its
Electron preload API and pairs with a long-running Orca runtime. CoDev provides
the same renderer boundary through `createOrcaRuntimeAdapter`: file listing,
search, reads, writes, Git operations, branch checkout, and PTY streaming map
to authenticated CoDev APIs and then to `codev-guestd` over vsock. Agent and
worktree operations continue through CoDev's durable agent APIs.

## Upstream tracking

The renderer fork is based on Orca commit
`6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc` (`v1.4.177-rc.0`). The upstream
MIT license and reference metadata are retained under `third_party/orca/`.
