---
name: sandbox-vs-ide
description: Use when touching agent execution, worktrees, publication exports, IDE terminals, Git in the browser IDE, `/ide` routes, sandbox API routes, Firecracker, or anything files must be visible to `codex resume`. Activate for workspace runtime, isolation, or Vercel vs Azure boundary work.
---

# Sandbox vs IDE

Firecracker sandbox and Orca IDE session **do not share a disk**.

| Intent                                                    | Use                              |
| --------------------------------------------------------- | -------------------------------- |
| Agent execution, worktrees, publication export            | Sandbox API routes               |
| Interactive IDE files, terminals, Git, user-launched CLIs | `/ide` file and execution routes |

Do not mix. Control plane remains Vercel; runtimes run on **Azure** — the EC2
migration is done. `CLOUD_PROVIDER` defaults to Azure and the retired EC2 host
is parked in `apps/web/lib/retired/`, outside the typecheck and test runs, so
flipping that variable no longer moves the runtime by itself.
