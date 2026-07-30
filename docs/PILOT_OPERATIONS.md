# CoDev Closed-Beta Pilot Operations

## Access

The pilot console is served at `/pilot`. Access requires a signed-in GitHub
identity whose login appears in the comma-separated, server-only
`PILOT_ADMIN_GITHUB_LOGINS` environment variable. The page and every mutation
API enforce the allowlist independently.

The `pilot_sessions` table has Row Level Security enabled and grants to the
Supabase `anon` and `authenticated` Data API roles are revoked. CoDev accesses
it only through the server-side PostgreSQL connection.

## Validation session

1. Run the launch preflight from Settings and start a pilot against the intended
   workspace.
2. Invite and authenticate the second GitHub identity.
3. Verify realtime presence/editing and authenticated terminal access.
4. Complete turns from two agent sessions.
5. Create and resolve a contested path claim.
6. Review and publish an immutable `codev/*` branch.
7. Confirm the repository default branch did not change.
8. Submit and triage design-partner feedback.
9. Stop the sandbox and confirm teardown.
10. Mark the pilot complete only after all checkpoints are recorded.

If the run cannot continue, choose the closest blocker category and mark it
blocked. The same session can resume later; do not create a second active
session for the workspace.

## Product signals

The console calculates these seven-day signals from existing operational
metadata:

- Active users: distinct workspace-event actors.
- Returning users: current active users who were also active 7–14 days ago.
- Shared workspaces: workspaces with two or more distinct event actors.
- Co-steering rate: percentage of agent sessions with turns by two or more
  authors.
- Contested claims: path claims currently recorded as contested.
- Branches published: successful immutable branch publications.
- Feedback items: design-partner feedback submissions.

Queries are bounded to 10,000 recent activity rows while the product is in
closed beta. Revisit aggregation strategy before opening access broadly.

## Privacy boundary

Pilot evidence stores checkpoint booleans, status, blocker category, release,
workspace reference, operator reference, and timestamps. Metrics use IDs,
statuses, and timestamps already required to operate CoDev.

Do not copy source code, prompts, model output, diffs, terminal output, GitHub
tokens, OpenAI keys, or encrypted credential values into pilot records,
structured logs, screenshots, or incident notes. Feedback text is visible to
allowlisted operators because users explicitly submit it for product review.
