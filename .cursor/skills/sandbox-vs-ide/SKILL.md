---
name: sandbox-vs-ide
description: Use when touching agent execution, worktrees, publication exports, the embedded Orca IDE, its parent/iframe bridge, sandbox API routes, Firecracker, or anything files must be visible to `codex resume`. Activate for workspace runtime, isolation, or Vercel vs AWS boundary work.
---

# Sandbox vs IDE

A workspace has two AWS-hosted execution contexts that **do not share a disk**:

1. **Firecracker sandbox** — backend-driven work: agent execution, worktrees,
   publication exports. `apps/web` talks to it directly over real Next.js API
   routes: `app/api/workspaces/[workspaceId]/sandbox/{route,branches,checkout,exec,files,git,terminal,terminal/stream}`.
2. **Orca IDE session** — one `orca serve` process per workspace, embedded in
   `apps/web` as a same-origin iframe (`components/orca-workspace.tsx`). There
   is **no parallel `/ide` route tree** in `apps/web` — the iframe talks to the
   parent page over `postMessage`
   (`packages/ide` → `codev-bridge.ts`; parent → `components/codev-parent-bridge.ts`),
   which verifies origin/window and then proxies each request to an ordinary
   `/api/workspaces/{id}/...` endpoint (`presence`, `collaboration/conflicts`,
   `agents/{sessionId}/...`, etc.) — the same namespace the sandbox uses, not a
   segregated one. GitHub/provider credentials never cross that bridge.

The one place `/ide` is a literal path is on the **Rust orchestrator**
(`services/orchestrator`), not in `apps/web`:
`POST/GET /v1/sandboxes/{workspaceId}/ide` returns Orca runtime pairing /
readiness (see `apps/web/lib/orca-pairing.ts` and
`services/orchestrator/src/backend/orca.rs`). Don't confuse that
orchestrator-side pairing endpoint with an `apps/web` "IDE routes" family —
it isn't one.

Anything `codex resume` or a terminal must see — files, running processes —
lives only inside the IDE session's runtime, not the sandbox's. Do not write
sandbox files expecting the IDE session to see them, or the reverse.
