# CoDev Design-Partner Launch Checklist

Use this checklist for each early-access session. A design-partner session is
not complete until its workspace is published or explicitly discarded and the
AWS host is returning to `stopped`.

## Preflight

1. Open Settings and run **Launch preflight**.
2. Require website, database, realtime, orchestrator, and GitHub checks to pass.
3. With no active workspace, require scale-to-zero to report `safe`.
4. Confirm the GitHub App is installed on the intended repository with Contents
   read/write access.
5. Confirm the presenter has an encrypted OpenAI key saved.
6. Use a disposable `codev/` publication branch and record the default-branch
   SHA before the session.

## Backend journey

1. Create either a public workspace or a private workspace no larger than 500
   files and 3 MiB decoded.
2. Start the Firecracker sandbox through the authenticated sandbox API.
3. Read and revision-safely write a file, run a harmless PTY command, and query
   Git status through the workspace APIs.
4. Connect from a second GitHub identity and verify Yjs presence, reconnect
   recovery, and revision-safe collaboration at the protocol layer.
5. Start two agents attached to distinct exact GitHub issues.
6. Exercise an overlapping claim, coordination response, checkpoint review,
   rebase when needed, and merge into integration.
7. Publish an immutable `codev/` branch. Confirm its files and ensure the
   recorded default-branch SHA did not change.
8. Submit categorized feedback from Settings without pasting product secrets.

## Teardown and evidence

1. Stop the workspace after publication.
2. Run lifecycle reconciliation twice; the second call must be a no-op.
3. Confirm the workspace is stopped and the Firecracker host transitions to
   `stopped`.
4. On the AWS host, run `sudo /opt/codev-verify-lifecycle.sh` and preserve its
   snapshot/restore timings as deployment evidence.
5. Confirm Vercel has no new error logs and AWS alarms remain `OK`.
6. Preserve the publication URL, request IDs for failures, preflight result,
   feedback identifier, and test results in the session notes.
