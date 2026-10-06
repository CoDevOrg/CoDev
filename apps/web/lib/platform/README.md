# Platform

This module owns foundational infrastructure integrations and platform-level cross-cutting concerns. It includes rate limiting, observability, cryptography/KMS, and database connection utilities.

**Does not own:** Domain-specific business logic or application state.

**Key files:**

- `database.ts`: Shared Postgres client. On Cloudflare Workers each request opens its own pool through the `HYPERDRIVE` binding and closes it when the response finishes. On Vercel it keeps one pool on `POSTGRES_URL`.
- `cloudflare-worker.ts`: Cloudflare entrypoint that forwards requests to vinext, completes Gen 2 WebSocket upgrades, and dispatches the scheduled compute reconciliation route.
- `websocket.ts`: WebSocket upgrade and message adapter for Cloudflare Workers and Vercel. The Worker retains initialization with `waitUntil`.
- `database-operation.ts`: Operation-owned Hyperdrive pools for WebSocket messages and guest polls; connections are reused within the operation and the pool closes when it completes.
- `observability.ts`: Application logging and metrics.
- `rate-limit.ts`, `upstash-rate-limit.ts`: API and action rate limiting.
- `kms.ts`, `crypto.ts`: Key management and encryption utilities.

- `privacy-preferences.ts`: analytics consent interpretation and URL minimization shared by browser and server ingestion.
- `runtime-environment.ts`: Live Worker bindings take precedence over Node environment values for runtime secrets; Vercel uses its Node environment.
