# Auth

This module owns user authentication, identity, and session management. It provides utilities for sign-in gates, password policies, registration, feature access validation, and CLI authentication flows.

**Does not own:** Third-party OAuth provider logic (handled by providers) or UI components for login.

**Key files:**

- `auth-cookie.ts`, `session.ts`: Managing host-only user sessions and cookies.
- `session-revision.ts`, `session-socket.ts`: Bind browser sessions to the current credential state and revalidate open workspace sockets every 15 seconds.
- `read-session-revision.ts`: Socket revalidation uses short-lived Hyperdrive pools because the handshake's HTTP pool is already closed.
- `password-login-limit.ts`: Account-wide password throttling for both Auth.js HTTP handlers and server actions, using the existing Redis configuration and failing closed in production.
- `update-account-password.ts`: Conditional password changes and atomic revocation of other browser sessions, CLI tokens and device approvals.
- `user-sessions.ts`, `session-token.ts`, `session-rotation.ts`, `manage-sessions.ts`: Revocable server-side session rows. The jwt callback validates cookie + row in one query; signed rotation tickets keep the current browser signed in across its own credential change.
- `two-factor.ts`, `two-factor-challenge.ts`, `totp.ts`: Authenticator-app 2FA with single-use recovery codes, enforced for password, Google and GitHub sign-in through an httpOnly challenge cookie and the `two-factor` credentials provider.
- `change-password.ts`, `current-password.ts`, `password-link.ts`, `new-password.ts`, `breached-password.ts`: Signed-in password changes and re-authentication, emailed set/reset links (2FA-gated), and the shared new-password policy including the Have I Been Pwned range check.
- `security-events.ts`, `security-mail.ts`, `auth-mail.ts`, `cli-access-tokens.ts`: Security history, alert emails, and CLI/app login listing for Settings.
- `admin-handoff.ts`: Single-use, one-minute tickets that let a public-site administrator open the admin host without signing in again; admin status and credential revision are rechecked on redemption.
- `identity.ts`, `registration.ts`: Core user identity and signup flows.
- `password-reset.ts`, `password-reset-mail.ts`: Signed link tokens and their email. Production reset links default to the canonical HTTPS site when Auth.js URL overrides are omitted.

See `docs/security/account-security.md` for the account security model.

- `account-deletion*.ts`: verified self-service deletion, resource checks, account erasure and shared-history attribution. See `docs/LEGAL.md` for retention limits.
