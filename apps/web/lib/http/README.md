# HTTP

This module owns HTTP layer abstractions and server-side utilities. It provides standardized helpers for Next.js API routes and handles HTTP-level formatting for database and API errors.

**Does not own:** Business logic for specific features or client-side fetch wrappers.

**Key files:**

- `api.ts`, `api-route.ts`: Core abstractions for API handlers; cookie-authenticated mutations require an exact matching Origin. Explicitly enabled, authenticated CLI bearer requests remain supported.
- `database-error.ts`: Mapping database exceptions to HTTP error responses.

- `forwarded-request.ts`: preserves the public URL for authenticated Azure edge requests, including same-origin checks and generated links.
- `same-origin.ts`: Exact origin checks for browser-only requests and WebSocket handshakes; missing origins are rejected.

- `browser-mutation-origin.ts`: proxy protection for cookie-authenticated API mutations outside the shared wrapper; Auth.js CSRF-protected flows and signed Stripe webhooks retain their own authentication.
