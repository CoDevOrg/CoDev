---
name: drizzle-postgres
description: Use when changing PostgreSQL schema, Drizzle queries, migrations, or packages/db. Also when persistence for Yjs/Hocuspocus touches Postgres. Do not use for OpenFGA modeling or client UI.
---

# Drizzle

- Schema and queries live in `packages/db`.
- Copy existing table/column/relation style.
- Validate inputs with Zod at the boundary before insert/update.

## Migrations

Never write, rename, or hand-edit a migration `.sql` file, and never apply a
hand-written prod dump. Edit `packages/db/src/schema.ts`, then generate:

```bash
pnpm db:generate            # add --name=<descriptive_name> for a readable filename
```

Commit all three generated files together — `drizzle/NNNN_*.sql`,
`drizzle/meta/_journal.json`, `drizzle/meta/NNNN_snapshot.json`. Drizzle reads
the journal, not the directory, so an unjournaled file never runs while
`pnpm db:migrate` still reports success; a missing snapshot makes the next
`db:generate` emit a duplicate migration.

Drizzle also applies migrations by timestamp high-water mark, running only those
newer than the newest already-applied row. Every branch shares one Supabase
database, so a migration generated before one that has already landed is skipped
silently — regenerate after merging `main` if `main` gained a migration in the
meantime. See "Database migrations" in `AGENTS.md` for the full rule.
