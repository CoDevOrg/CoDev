---
name: sandbox-vs-ide
description: Use when touching agent execution, worktrees, publication exports, IDE terminals, Git in the browser IDE, `/ide` routes, sandbox API routes, Firecracker, or anything files must be visible to `codex resume`. Activate for workspace runtime, isolation, or Vercel vs AWS boundary work.
---

# Sandbox vs IDE

Firecracker sandbox and Orca IDE session **do not share a disk**.

| Intent                                                    | Use                              |
| --------------------------------------------------------- | -------------------------------- |
| Agent execution, worktrees, publication export            | Sandbox API routes               |
| Interactive IDE files, terminals, Git, user-launched CLIs | `/ide` file and execution routes |

Do not mix. Control plane remains Vercel; runtimes remain AWS.
