# Account security

How CoDev protects member accounts: browser sessions, passwords, two-factor
authentication, and the security history shown in Settings. Code lives in
`apps/web/lib/auth/`; the UI is Settings → Security and Settings → Sessions.

## Browser sessions

Auth.js issues an encrypted JWT cookie (host-only, `httpOnly`). Each sign-in
also inserts a `user_sessions` row, and the cookie carries only that row id
(`sid`). Every authenticated request validates the cookie with **one** query
(`readSessionState`): the account's credential revision (a hash of the
password hash) plus the session row. A revoked row or a changed password ends
the session on its next request; workspace sockets recheck every 15 seconds.

- Signing out revokes the row (Auth.js `events.signOut`), so a copied cookie
  stops working instead of living out its 30 days.
- Settings → Sessions lists live rows and signs out one or all others.
- Cookies issued before session tracking have no `sid`. On first use each one
  is adopted onto its own listed row, keyed by the cookie's JWT id so repeat
  reads reuse it, so deploying this signed nobody out. One deterministic
  "legacy" row per member, which exists only once revoked, stops any not yet
  adopted after "sign out other sessions" or a password change.
- Linking GitHub from Settings replaces the browser's cookie; the session it
  held is revoked.
- A server action that re-issues the current cookie (password change, sign
  out others) passes a signed, one-minute rotation ticket through
  `unstable_update`; client `update()` payloads cannot move a cookie to a new
  revision or row. Such actions redirect afterwards: a same-request
  re-render would read the old cookie from `headers()`.

## Passwords

- Policy: 10–128 characters with upper, lower, digit and symbol, not a common
  password, and not in the Have I Been Pwned corpus (k-anonymity range API; an
  outage fails open). Hashes use scrypt.
- Changing a password requires the current one (five tries per 15 minutes),
  keeps the current browser signed in, and revokes every other session, all
  CLI tokens, and pending CLI device approvals in one transaction.
- Forgot password: the form answers identically for every address, and the
  lookup and email run after the response, so timing does not reveal accounts.
  Links are HMAC-signed, expire in one hour, and are bound to the current
  password state, so any use or password change voids them. OAuth-only accounts
  receive a link to create their first password. The link page sends no
  referrer. Accounts with 2FA must also enter a code to reset.
- Members without a password create one from Settings through the same emailed
  link, which proves email ownership instead of trusting the session alone.

## Two-factor authentication

TOTP (RFC 6238: SHA-1, 6 digits, 30 seconds, ±1 step) with an encrypted secret
and ten single-use recovery codes stored as SHA-256 hashes.

- Applies to password, Google, and GitHub sign-in. After the first factor,
  CoDev sets a ten-minute, httpOnly challenge cookie instead of a session; the
  `two-factor` credentials provider exchanges it plus a code for the session.
  Linking GitHub from an already signed-in account does not ask again.
- Google and GitHub sign-ins never attach themselves by email to an account
  with 2FA (that would happen before any code is asked), and the session user
  is resolved by the provider identity the callback approved, never by email
  (emails are not unique).
- Codes are single-use: the accepted step is stored with a compare-and-swap,
  and recovery codes are consumed the same way. Six attempts per 15 minutes.
- Turning 2FA on requires the current password, so a stolen session cannot
  lock the owner out with its own authenticator; OAuth-only accounts create a
  password first through the emailed link. Turning it off or regenerating
  recovery codes requires a current code.

## Notifications and history

Password changes and resets, 2FA changes, and recovery-code use email the
member (after the response). `user_security_events` records sign-ins and
security changes with IP address and user agent; Settings shows the latest.
Pruning is opportunistic, not scheduled: a member's events older than 180 days
are deleted when they get a new event, and their session rows idle or revoked
for 30 days are deleted at their next sign-in. Both cascade on account
deletion. Rate limits use the shared Redis limiter and fail closed in
production.
