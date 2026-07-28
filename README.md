# CoDev

CoDev is a hosted, browser-based engineering workspace where people and AI
agents plan, build, and review software side by side. This repository contains
the website source; CoDev is not a downloadable desktop application.

> Phase 1 is a public foundation preview. The workspace uses typed fixture data
> and clearly labels repository, terminal, and agent connections as unavailable.

## Website

- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Local landing page: `http://localhost:3000`
- Fixture workspace: `http://localhost:3000/workspaces/demo`
- Health endpoint: `http://localhost:3000/api/health`
- Database health: `http://localhost:3000/api/health/database`

## Repository

```text
apps/web/               Next.js website and Vercel Functions
packages/contracts/     Shared Zod domain and event contracts
packages/config/        Server-only environment validation
packages/db/            Drizzle schema and PostgreSQL migrations
services/orchestrator/  Go sandbox-service boundary
```

## Development

Node.js 24+, pnpm 11.5.0, and Go 1.25 are required.

```bash
pnpm install
pnpm dev
```

Run all Phase 1 checks:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm go:check
git diff --check
```

Optional local PostgreSQL uses [Apple Container](https://github.com/apple/container)
with an OCI image:

```bash
./scripts/dev-services.sh
```

Docker and Docker Compose are intentionally not part of this repository.

Production, preview, and development environments are connected to the
`codev-db` Supabase resource through Vercel Marketplace. Pull the development
credentials into the gitignored local environment with:

```bash
vercel env pull apps/web/.env.local --environment=development --yes
```

See [PRD.md](./PRD.md) for the product specification and [PLAN.md](./PLAN.md)
for the eight-phase delivery roadmap.
