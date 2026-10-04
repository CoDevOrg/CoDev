# Platform

This module owns foundational infrastructure integrations and platform-level cross-cutting concerns. It includes rate limiting, observability, cryptography/KMS, and database connection utilities.

**Does not own:** Domain-specific business logic or application state.

**Key files:**

- `database.ts`: Shared Postgres client. On Cloudflare Workers each request opens its own pool through the `HYPERDRIVE` binding and closes it when the response finishes. On Vercel it keeps one pool on `POSTGRES_URL`.
- `cloudflare-worker.ts`: Cloudflare entrypoint that forwards HTTP requests to vinext and dispatches the scheduled compute reconciliation route.
- `observability.ts`: Application logging and metrics.
- `rate-limit.ts`, `upstash-rate-limit.ts`: API and action rate limiting.
- `kms.ts`, `crypto.ts`: Key management and encryption utilities.
