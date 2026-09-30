# Agent guidance

## Repository map

- `apps/web/app/`: Next.js pages and layouts; `app/api/` contains HTTP routes.
- `apps/web/components/`: UI grouped by feature; `components/ui/` has shared primitives.
- `apps/web/lib/`: feature logic, including `gen2`, `auth`, `providers`, `runtime`, and `http`.
- `packages/`: shared `contracts`, `db`, `shared-types`, and `config` packages.
- `services/orchestrator/`: Rust workspace and agent runtime service.
- `infra/azure/` and `infra/runtime/`: Azure stack and runtime host scripts.
- `vendor/superset/`: vendored Superset source; search it only for related work.
- `docs/README.md`: documentation index with freshness status. Start there for deeper background.

## Key conventions and gotchas

- CoDev is a hosted web app. `apps/web` is the Vercel control plane; active Gen 2 workspaces run in Azure Firecracker guests.
- In Gen 2, the agent, editor, terminal, and Git use the same guest filesystem.
- Use Node.js 24+ and `pnpm` for this repository.

## UI work

For any UI work, use shadcn/ui and the `shadcn` skill. If the skill is unavailable, install it with one of these commands:

- `pnpm dlx skills add shadcn/ui`
- `npx skills add shadcn/ui`
- `yarn dlx skills add shadcn/ui`
- `bun x skills add shadcn/ui`

## Maintain this guidance

Before finishing a task, check whether this file sent you to the wrong place, missed a reusable project convention, or contains a stale claim. When you can verify a durable improvement, update the relevant line in the same change: correct or remove outdated guidance, or add one concise instruction. Keep task notes and unverified guesses out of this file. If nothing needs improving, leave it as is.
