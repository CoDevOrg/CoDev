# CoDev Design-Partner Demo

Use a disposable public or bounded private repository and a branch under
`codev/`. Never demo against `main`.

## Before the call

1. Confirm `https://codev-xi.vercel.app/api/health` is `ok`.
2. Run Settings → **Launch preflight** and confirm every dependency passes.
3. Confirm the GitHub App has Contents **Read and write**, Pull requests
   **Read and write**, and Metadata **Read-only** permissions, and that the
   installation covers the demo repositories.
4. Confirm the presenter has a saved OpenAI key in CoDev settings.
5. Run the lifecycle reconciler and verify the EC2 host is stopped.
6. Keep the AWS EC2 and Vercel logs pages available as recovery views.

## Demo flow

1. Sign in with GitHub and choose the GitHub App installation.
2. Create a workspace from the disposable repository.
3. Start the sandbox. Bare-metal wake and guest provisioning can take roughly
   one to three minutes. If it exceeds three minutes, refresh runtime status;
   after five minutes, abort and inspect readiness/logs.
4. Open the browser IDE, edit a file, and run a harmless terminal command.
5. Open the workspace in a second browser profile to show realtime presence and
   editing recovery.
6. Start two agents with exact, non-duplicate GitHub issues.
7. Have both claim an overlapping path, show the contest, and resolve it with a
   typed coordination message.
8. Review each checkpoint. Rebase any stale agent, then merge the approved
   digest into integration.
9. Enter `codev/design-partner-demo` in the IDE publication control and publish.
10. Open the returned GitHub link. Confirm the branch exists, its files match
    the integration tree, and `main` did not move.
11. Stop the workspace. CoDev should accept the stop only after publication.
12. Run lifecycle reconciliation twice and confirm the second run is a no-op.
13. Confirm the EC2 host returns to `stopped` after the idle window.

## Expected recovery points

- Dirty integration tree: save/checkpoint before publication.
- Active agent worktrees: merge or discard them before publication or stop.
- GitHub 403: approve the App's Contents write and Pull requests write
  permissions; do not use a PAT or put a token in the sandbox.
- Existing publication ref: choose a new immutable `codev/` branch. CoDev never
  overwrites it.
- Realtime disconnect: wait for reconnect and state-vector resubscription.
- Runtime missing: run lifecycle reconciliation. A published source recovers
  from its remote commit; unpublished loss is explicit failure.

After any aborted demo, interrupt agents, discard remaining agent worktrees,
publish recoverable integration work if appropriate, stop the workspace, run
cleanup, and verify EC2 scale-to-zero.
