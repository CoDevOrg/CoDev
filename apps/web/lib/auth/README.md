# Auth

This module owns user authentication, identity, and session management. It provides utilities for sign-in gates, password policies, registration, feature access validation, and CLI authentication flows.

**Does not own:** Third-party OAuth provider logic (handled by providers) or UI components for login.

**Key files:**

- `auth-cookie.ts`, `session.ts`: Managing host-only user sessions and cookies.
- `session-revision.ts`, `session-socket.ts`: Bind browser sessions to the current credential state and revalidate open workspace sockets every 15 seconds.
- `read-session-revision.ts`: Socket revalidation uses short-lived Hyperdrive pools because the handshake's HTTP pool is already closed.
- `password-login-limit.ts`: Account-wide password throttling for both Auth.js HTTP handlers and server actions, using the existing Redis configuration and failing closed in production.
- `update-account-password.ts`: Conditional password changes and atomic CLI-token/device-approval revocation.
- `identity.ts`, `registration.ts`: Core user identity and signup flows.
- `password-reset.ts`, `password-reset-mail.ts`: Password recovery mechanisms. Production reset links default to the canonical HTTPS site when Auth.js URL overrides are omitted.

- `account-deletion*.ts`: verified self-service deletion, resource checks, account erasure and shared-history attribution. See `docs/LEGAL.md` for retention limits.
