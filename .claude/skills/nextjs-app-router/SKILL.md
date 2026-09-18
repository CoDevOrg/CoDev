---
name: nextjs-app-router
description: Use for apps/web Next.js App Router work — pages, layouts, Server Components, Server Actions, route handlers, `'use client'`, Vercel hosting. Activate when editing apps/web or Next routing/rendering. Do not use for Expo, Orca packages/ide, or the Rust orchestrator.
---

# Next.js App Router (`apps/web`)

1. Prefer Server Components. `'use client'` only for state, effects, or event handlers.
2. Before editing, open a sibling route in `apps/web` and match its data-fetch / mutation pattern. API route handlers are `export const GET = withWorkspace("view", async ({ request, user, workspaceId }) => ...)` (or `withUser`) from `lib/api-route.ts`; see AGENTS.md.
3. Use Next DevTools MCP (`nextjs_docs`, `get_errors`, `get_routes`, `get_logs`). Do not guess App Router APIs from memory.
4. Keep `pnpm dev` running while verifying UI.
5. Secrets stay on the server. No credentials in `NEXT_PUBLIC_*`.
6. Collaboration/realtime sockets are not this app’s long-lived process — that is `apps/hocuspocus-server`.

- `apps/web/.next/dev` is the dev-server cache and grows without bound (5.4 GB
  here before a cleanup). It is gitignored and fully regenerable: delete it when
  the working tree feels slow, and keep `.next/cache`, which is the production
  build cache. `apps/web/tsconfig.json` includes `.next/dev/types/**`, so a
  bloated dev cache also slows `tsc`.
- `apps/web/vitest.config.ts` runs two projects: `lib` on `node` with no setup
  file, `components` on `jsdom` with Testing Library. Put a pure-logic test under
  `lib/`. Do not restore a global `jsdom` environment — it cost this suite 4x its
  runtime.
