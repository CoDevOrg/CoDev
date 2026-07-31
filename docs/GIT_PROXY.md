# Git-over-control-plane proxy

Design for full `git pull` / `git push` / `git commit` inside CoDev
workspaces **without** placing GitHub credentials in the Firecracker guest.

Status: design only. PR creation and stopped-workspace sync already shipped
(`d325bff`); this document covers the remaining terminal git UX.

## Constraints (facts from the current runtime)

1. **Credential-free guest.** Private repos are snapshotted into the microVM
   with no `origin` and no token
   (`services/orchestrator/src/backend/firecracker.rs`). Public repos get a
   read-only public `origin`. Tokens must stay on the Vercel control plane.
2. **Private snapshot HEAD ≠ GitHub `baseSha`.** `materialize_snapshot`
   writes files, commits locally as "Import private repository snapshot",
   and returns a new local `head_sha`. `markWorkspaceReady` stores that
   guest HEAD on the integration worktree. Fetch/push negotiation must
   therefore map between GitHub object IDs and the guest's local history,
   not assume they share the same commit graph.
3. **No guest network.** Firecracker machines are configured with drives +
   vsock only (`guest.vsock` on port 52). There is no TAP device, CNI,
   iptables, DNS, or egress path under `services/orchestrator`. A guest
   process cannot dial GitHub or Vercel.
4. **All guest I/O is RPC.** Browser → Vercel → API Gateway (SigV4,
   `execute-api`) → Lambda VPC proxy → orchestrator → vsock → `guestd`.
   The Rust orchestrator itself has no bearer/HMAC middleware; IAM at API
   Gateway is the trust boundary. Existing surfaces: files, exec, PTY,
   worktrees, publication export, git status/diff/show only (no
   fetch/pull/push endpoints today).
5. **Publication is already a mediated push.**
   `exportSandboxPublication` reads a clean HEAD tree from the guest;
   `createGitHubCommit` + `ensureGitHubRef` write via the GitHub Git
   Database API using the **stored user OAuth token**
   (`getGitHubUserToken` / refresh). There is no App installation-token
   minting path today. Pull requests layer on published `codev/*`
   branches.
6. **No existing proxy.** `docs/SECURITY.md` explicitly forbids tokens in
   clone URLs or credential helpers. There is no smart HTTP /
   `git-http-backend` / packfile relay in the repo.
7. **API Gateway throttles.** Live verification observed intermittent HTTP
   429 from `execute-api`. Any chatty git protocol must batch and back off.

## Goals

| User action              | Required behavior                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `git commit`             | Already works (local object DB in the guest).                                                                       |
| `git pull` / `git fetch` | Bring commits from the GitHub default branch (and optionally other refs) into the guest without a guest-held token. |
| `git push`               | Publish local commits to an allowed remote ref (default: `codev/*` only) without a guest-held token.                |
| Make a PR                | Already shipped: open PR from a published `codev/*` branch (requires GitHub App **Pull requests: Read and write**). |

Non-goals for v1:

- Pushing directly to `main` / the default branch.
- Arbitrary remotes outside the workspace repository.
- Putting a GitHub token or credential helper secret in the guest.
- Smart HTTP from the guest to the public internet.

## Recommended architecture

```text
┌──────── guest (no egress) ────────┐
│  git pull/push                     │
│       │                            │
│  git-remote-codev (remote helper)  │
│       │ HTTP localhost / UDS       │
│  guestd                            │
└───────────────┬───────────────────┘
                │ vsock
┌───────────────▼───────────────────┐
│  orchestrator (host)               │
│  /v1/sandboxes/{id}/git/{fetch,push}
└───────────────┬───────────────────┘
                │ API Gateway (SigV4)
┌───────────────▼───────────────────┐
│  Vercel control plane              │
│  apps/web/lib/github-git-proxy.ts  │
│  uses getGitHubUserToken()         │
│  talks to api.github.com           │
└────────────────────────────────────┘
```

### Why a git remote helper

Git already supports `git-remote-<transport>`. Configuring:

```text
git remote add origin codev://workspace
```

makes ordinary `git fetch`, `git pull`, and `git push` invoke
`git-remote-codev`, which speaks a tiny RPC to `guestd` instead of the
network. Users get real git UX; the security boundary stays intact.

### Control-plane operations

**Fetch (pull path)**

1. Helper asks guestd for "fetch `refs/heads/<default>` (and advertised
   tips)".
2. Orchestrator forwards to Vercel `POST /api/workspaces/:id/git/fetch`.
3. Control plane, with the user token:
   - Resolves the tip SHA via GitHub Git Data API.
   - Downloads the missing commit/tree/blob objects (or a shallow bundle).
4. Objects are streamed back guest-ward and `git unpack-objects` /
   `git fetch-pack --stdin` style ingestion updates local refs under
   `refs/remotes/origin/*`.
5. `git pull` then merges locally as usual.

**Push**

1. Helper advertises local refs; control plane advertises remote
   `codev/*` tips.
2. Helper sends a pack of missing objects + want/have negotiation summary.
3. Control plane validates:
   - Actor has `canMerge`.
   - Ref matches `publicationBranchNameSchema` (`codev/…` only).
   - Fast-forward or explicit force policy (v1: fast-forward only; no
     overwrite of an existing published immutable ref — match today's
     publication semantics, or allow updates only for refs CoDev created
     in this workspace).
4. Control plane creates blobs/trees/commits via the Git Data API (same
   building blocks as `github-publication.ts`) and updates the ref.
5. On success, update `published_branches` (or a new `git_refs` table) and
   emit `git.pushed`.

### Ref policy (v1)

| Ref                          | Fetch     | Push                  |
| ---------------------------- | --------- | --------------------- |
| `refs/heads/<defaultBranch>` | yes       | no                    |
| `refs/heads/codev/*`         | yes (own) | yes (workspace-owned) |
| other heads / tags           | no        | no                    |

This preserves "never push to main from CoDev" while unlocking real
branch iteration.

## Phased delivery

### Phase A — Finish the model-fitting slice (done / almost done)

- [x] Sync stopped workspace to latest default branch.
- [x] Open PR from published `codev/*` branch.
- [ ] Grant GitHub App **Pull requests: Read and write** and re-verify the
      CoDev `POST /pull-requests` path (currently 403).

### Phase B — Mediated fetch into a running sandbox

- Control-plane endpoint that fetches the default-branch tip and applies a
  new snapshot/pack into the guest via orchestrator (extend the private
  snapshot injector used at provision time).
- For private workspaces, do **not** assume GitHub SHAs exist in the guest
  object DB (synthetic snapshot commit). Prefer re-materializing the tip
  tree (or grafting a replace-ref) over a naive `git fetch` of GitHub
  objects onto the snapshot history.
- IDE/terminal command or `git fetch` stub that triggers it.
- Updates `refs/remotes/origin/<default>` inside the guest; does not yet
  require a full remote helper.

### Phase C — Mediated push of `codev/*` from a running sandbox

- Generalize publication export to "push these commits" (pack or
  commit-walk) instead of only "export current clean tree".
- Allow updating a workspace-owned `codev/*` ref (decide immutability:
  keep create-once, or allow FF updates).
- Wire IDE "Publish" to the same path so UI and terminal stay consistent.

### Phase D — `git-remote-codev` helper (full UX)

- Ship the helper binary/script in the guest rootfs.
- On provision, set `origin` to `codev://workspace` for both public and
  private repos (replace today's public HTTPS origin).
- Implement fetch/push capability lines over guestd RPC.
- Add integration tests with the Fake sandbox backend.

### Phase E — Hardening

- Object-size and pack-size caps (align with publication's 5 MiB / 500
  file limits, or raise deliberately).
- Idempotent request IDs; audit events `git.fetched` / `git.pushed`.
- API Gateway timeout/throttle strategy: prefer fewer large RPCs over
  chatty pack negotiation; consider async jobs for big fetches.
- Rate-limit per workspace/user on the control plane.

## Alternatives rejected

| Alternative                                                        | Why not                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Inject a GitHub token into the guest                               | Breaks the credential-free security model; agent code could exfiltrate it.                   |
| Give the guest egress + HTTPS to GitHub                            | Requires TAP/CNI, egress allowlists, and still needs credentials in-guest or a network MITM. |
| Run Smart HTTP git on the orchestrator host with a host-held token | Moves secrets onto the long-lived EC2 host; worse blast radius than Vercel-held user tokens. |
| Only keep Publish + Sync (no terminal git)                         | Does not meet the requested UX; kept as the interim.                                         |

## Prerequisites / follow-ups discovered during live verification

1. **GitHub App permission.** Opening PRs through CoDev requires
   **Pull requests: Read and write** on
   [CoDev Web Workspace](https://github.com/apps/codev-web-workspace).
   Contents write alone is not enough (production returned 403).
2. **API Gateway 429s.** Burst sandbox traffic (file list + export + exec)
   trips throttling. Proxy RPCs must be coarse-grained.
3. **Publication export cost.** Exporting a ~2 MiB / 200-file tree through
   vsock + API Gateway can fail as `Firecracker host unavailable` under
   load; push should prefer pack transfer of _delta_ commits, not a full
   tree re-export when possible.

## Success criteria

- From a running sandbox terminal: `git pull` updates the worktree from
  GitHub's default branch; `git push -u origin codev/<name>` creates or
  fast-forwards that ref on GitHub; `gh`-equivalent PR remains available
  via the existing Open pull request button.
- `git push origin main` is rejected with a clear error.
- No GitHub token, App private key, or installation token is ever present
  in guest memory, disk, or process environment (verified by guest env
  audit in tests).
- Unit tests cover ref policy and pack validation; an e2e smoke covers
  fetch → commit → push → open PR on a disposable repo.
