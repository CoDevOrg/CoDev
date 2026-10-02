# Platform

This module owns foundational infrastructure integrations and platform-level cross-cutting concerns. It includes rate limiting, observability, cryptography/KMS, and database connection utilities.

**Does not own:** Domain-specific business logic or application state.

**Key files:**

- `database.ts`: Shared Postgres client. On Cloudflare Workers it connects through the `HYPERDRIVE` binding; on Vercel it uses `POSTGRES_URL`.
- `observability.ts`: Application logging and metrics.
- `rate-limit.ts`, `upstash-rate-limit.ts`: API and action rate limiting.
- `kms.ts`, `crypto.ts`: Key management and encryption utilities.
