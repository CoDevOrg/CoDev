---
name: nextjs-app-router
description: Use for apps/web Next.js App Router work — pages, layouts, Server Components, Server Actions, route handlers, `'use client'`, Vercel hosting. Activate when editing apps/web or Next routing/rendering. Do not use for Expo, Orca packages/ide, or the Rust orchestrator.
---

# Next.js App Router (`apps/web`)

1. Prefer Server Components. `'use client'` only for state, effects, or event handlers.
2. Before editing, open a sibling route in `apps/web` and match its data-fetch / mutation pattern.
3. Use Next DevTools MCP (`nextjs_docs`, `get_errors`, `get_routes`, `get_logs`). Do not guess App Router APIs from memory.
4. Keep `pnpm dev` running while verifying UI.
5. Secrets stay on the server. No credentials in `NEXT_PUBLIC_*`.
6. Collaboration/realtime sockets are not this app’s long-lived process — that is `apps/hocuspocus-server`.
7. `apps/web/.next/dev` is the dev-server cache and grows without bound (5.4 GB
   before a cleanup). It is gitignored and regenerable: delete it when the tree
   feels slow, and keep `.next/cache`, the production build cache.
   `tsconfig.json` includes `.next/dev/types/**`, so a bloated dev cache also
   slows `tsc`.
8. `vitest.config.ts` runs two projects: `lib` on `node` (no setup file) and
   `components` on `jsdom`. Put pure-logic tests under `lib/`; do not restore a
   global `jsdom` environment.
9. `lib/retired/` is excluded from the typecheck and the vitest `lib` project.
   Nothing there is verified and nothing may import it.
