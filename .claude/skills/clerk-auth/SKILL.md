---
name: clerk-auth
description: Use when working on authentication, sessions, signed-in gates, or Clerk in apps/web. Do not use for OpenFGA authorization modeling unless the task also includes Clerk identity.
---

# Clerk

- - CoDev supports a configuration-gated auth transition: use Clerk when both Clerk keys are configured; Auth.js/NextAuth is the fallback for environments without Clerk. Do not introduce another provider or mix Clerk and Auth.js session flows in one deployment.
- Authz for resources may also involve OpenFGA — check sibling server code.
- Never send Clerk secrets to the client.
