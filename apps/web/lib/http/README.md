# HTTP

This module owns HTTP layer abstractions and server-side utilities. It provides standardized helpers for Next.js API routes and handles HTTP-level formatting for database and API errors.

**Does not own:** Business logic for specific features or client-side fetch wrappers.

**Key files:**

- `api.ts`, `api-route.ts`: Core abstractions for building robust API handlers.
- `database-error.ts`: Mapping database exceptions to HTTP error responses.

- `forwarded-request.ts`: preserves the public URL for authenticated Azure edge requests, including same-origin checks and generated links.
