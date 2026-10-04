# Auth

This module owns user authentication, identity, and session management. It provides utilities for sign-in gates, password policies, registration, feature access validation, and CLI authentication flows.

**Does not own:** Third-party OAuth provider logic (handled by providers) or UI components for login.

**Key files:**

- `auth-cookie.ts`, `session.ts`: Managing user sessions and cookies.
- `identity.ts`, `registration.ts`: Core user identity and signup flows.
- `password-reset.ts`, `password-reset-mail.ts`: Password recovery mechanisms.

- `account-deletion*.ts`: verified self-service deletion, resource checks, account erasure and shared-history attribution. See `docs/LEGAL.md` for retention limits.
