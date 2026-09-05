---
name: drizzle-postgres
description: Use when changing PostgreSQL schema, Drizzle queries, migrations, or packages/db. Also when persistence for Yjs/Hocuspocus touches Postgres. Do not use for OpenFGA modeling or client UI.
---

# Drizzle

- Schema and queries live in `packages/db`.
- Copy existing table/column/relation style.
- Migrations: use this package’s existing Drizzle migrate workflow, not hand-edited prod dumps.
- Validate inputs with Zod at the boundary before insert/update.
