---
name: clerk-auth
description: Use when working on authentication, sessions, signed-in gates, or Clerk in apps/web. Do not use for OpenFGA authorization modeling unless the task also includes Clerk identity.
---

# Clerk

- Follow existing `apps/web` Clerk server vs client usage. Do not add a second auth provider.
- Authz for resources may also involve OpenFGA — check sibling server code.
- Never send Clerk secrets to the client.
