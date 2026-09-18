---
name: auth
description: Use when working on authentication, sign-in, sessions, signed-in gates, or account linking in apps/web. Do not use for OpenFGA authorization modeling unless the task also changes who the signed-in user is.
---

# Authentication (`apps/web`)

- Auth.js / NextAuth v5 is the only sign-in system. It is configured in
  `apps/web/auth.ts` with GitHub, Google, and email + password (`Credentials`,
  backed by `lib/auth/credentials-auth.ts`). Clerk was removed; do not add
  another identity provider or a second session system.
- Server code gets the caller from `getCurrentAppUser()` in
  `lib/auth/identity.ts` (request-cached). API routes use `withUser` /
  `withWorkspace` from `lib/http/api-route.ts` rather than calling it directly;
  routes a CLI or the mobile app calls pass `{ anyAuth: true }` to also accept
  a `codev_cli_...` bearer token (`lib/auth/cli-auth.ts`).
- `proxy.ts` (Next 16's middleware) runs NextAuth on dashboard, settings,
  workspace and `/api/workspaces` paths, after edge rate limiting.
- Who may sign in at all is gated by `lib/auth/auth-sign-in-gate.ts` (the
  product is invite-only); invites are carried by `lib/auth/invite-grant.ts`.
- Workspace permissions are authorization, not authentication:
  `lib/auth/access.ts` (`requireWorkspacePermission`), optionally backed by
  OpenFGA (`infra/openfga`). Check sibling server code.
- `users.clerk_user_id` is a legacy column from accounts created while Clerk
  was wired in. Nothing writes it any more; leave it until a migration
  deliberately drops it.
- Never send `AUTH_SECRET` or provider secrets to the client.
