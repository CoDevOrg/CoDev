# Collaborative IDE verification fixtures

## B0.2 stable entry point

Open `/verification/b0-2` in local development or a Vercel preview. The page
is deterministic and does not call the database, AWS host, Orca, GitHub, or a
provider API, so it can be used to verify that the browser environment is
available before testing a real workspace flow.

The fixture route is enabled automatically when `NODE_ENV` is not
`production`, and on Vercel preview deployments (`VERCEL_ENV=preview`). A
production deployment returns not found unless
`CODEV_ENABLE_VERIFICATION_FIXTURES=true` is explicitly set. The Playwright
web server sets that opt-in for local production-mode test runs.

## Fixture identities and data

These identities are display-only test records. They are not accounts and have
no passwords, API keys, OAuth grants, or provider credentials.

| Identity    | Email                              | Role         |
| ----------- | ---------------------------------- | ------------ |
| Alex Morgan | `alex.owner@example.test`          | Owner        |
| Jordan Lee  | `jordan.collaborator@example.test` | Collaborator |

The seeded workspace is `CoDev Fixture Workspace` for the public-looking
repository `acme/codev-fixture`, on `main`, at `/workspace/codev-fixture`. Its
displayed files are `README.md`, `src/hello.ts`, and `tests/hello.test.ts`.

For the reusable screenshot convention used by browser verification, see
[COLLABORATIVE_IDE_EVIDENCE.md](./COLLABORATIVE_IDE_EVIDENCE.md).
