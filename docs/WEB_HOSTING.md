# Web hosting: Cloudflare, Azure, and Vercel

Public requests follow **Cloudflare → Azure Container Apps → Supabase/Redis**.
Cloudflare Workers Free runs a small streaming proxy, including WebSocket upgrades;
Next.js rendering, authorization, database work, and socket messages run on Azure.
The admin console lives at `/admin`; Next.js permanently redirects the legacy
`/gen2/admin` link on the admin hostname before workspace routing, preserving the admin authorization gate.
The Next.js proxy uses the authenticated edge public hostname, not the custom server’s internal URL, for the admin boundary.
API requests preserve the authenticated edge origin for terminal same-origin checks,
billing return URLs, workspace shares, and CLI sign-in links.
This removes the 10 ms Worker CPU limit from app execution. It does not guarantee
zero outages: database, Redis, runtime tunnels, and Azure can still fail.

| Service                             | Ownership                                                                                                                                                        | Release configuration                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `codev-azure-edge` Worker           | `trycodev.com`, `www.trycodev.com`, `admins.trycodev.com/*`; streams requests and dispatches the two every-minute maintenance routes to Azure                    | `apps/web/wrangler.azure-edge.jsonc`                               |
| `codev-web-origin` Container App    | Next.js HTTP server and authorized Gen 2 WebSockets; two warm 1 CPU/2 GiB replicas, autoscaling to six at 20 concurrent HTTP requests or 70% CPU                 | `infra/azure/web-app.bicep`, `web.Containerfile`, `deploy-web.mjs` |
| `codev-cloudflare-preview` Worker   | Retained ARM lifecycle Workflows and authenticated workflow bridge on its `admins-84a.workers.dev` URL; no public domains or cron when `AZURE_WEB_ORIGIN` is set | `apps/web/wrangler.arm-lifecycle.jsonc`                            |
| Vercel `codev` project              | Existing Vercel deployment URLs and previews; no public production traffic depends on its hosting allocation                                                     | `.github/workflows/deploy-web.yml`                                 |
| Preview zone (`CODEV_PREVIEW_ZONE`) | Per-port workspace preview hosts, routed by each workspace's own tunnel to the guest preview proxy; no Worker routes                                             | `apps/web/lib/runtime/arm-workspace-preview-route.ts`              |

`https://www.trycodev.com` is the canonical public origin; generated links,
metadata, and default service URLs use it. A zone Redirect Rule (phase
`http_request_dynamic_redirect`) sends apex `GET`/`HEAD` requests outside
`/api/` to `www` with a 301, preserving path and query. Apex API calls are not
redirected, because authenticated runtime fetches reject redirects.

Azure hosting uses `codev-web-production` in West US 2, the
`codev-web-environment` Consumption environment, Basic registry
`codevwebprod8ad43`, and `codev-web-logs` (30 day Log Analytics retention).
The public app uses Supabase PostgreSQL and Upstash Redis on all replicas.
Workspace VMs and saved disks remain in their separate ARM infrastructure.

The CI production deployment job verifies the DB schema, builds and deploys an
immutable Azure image through ACR Tasks, waits up to five minutes for the new origin's release and
secret gate, switches the proxy, then deploys the retained ARM Worker without public routes.
Container Apps secrets reach the container as references, so a changed value
alone does not restart replicas. Each deploy therefore sets a fresh plain
`CODEV_DEPLOYMENT_ID`, which starts a new revision even for an unchanged commit
(for example, the redeploy after an ARM image promotion). `/api/ready` reports
it, and the deploy waits for that deployment as well as the commit.
The native lifecycle bundle omits the web app and uses vinext API shims instead of bundling the Next.js server, so it fits Workers Free. Azure
single-revision deployments retain the previous healthy revision until the new
one is ready. Startup/liveness probes check the process; readiness checks DB and
Redis. Long lived sockets can reconnect during release replacement.

Azure is billed to the existing subscription and consumes eligible credits.
Two warm replicas, registry storage/builds, log ingestion, and bandwidth have
costs even when no workspace VM is running; shared web hosting is separate from
per-member workspace compute allowances. Replica capacity is bounded at six.

## Where credentials go

- **Azure:** `AZURE_WEB_RUNTIME_SECRETS` is the private JSON base used by CI.
  CI overlays the shared ARM and billing bundles, cron credential, live ARM flags,
  and release SHA. `AZURE_WEB_ORIGIN` is a GitHub variable containing the HTTPS
  Container App origin. `AZURE_WEB_ORIGIN_SECRET` is a separate GitHub secret
  shared by Azure and the proxy. The origin rejects app traffic missing that
  credential; only health probes are public. Proxy routing headers are overwritten
  before forwarding. Keep the origin secret identical in both deployments.
  Azure's user-assigned `codev-web-origin` identity has AcrPull on the registry
  and Key Vault Crypto User on the existing credential vault. The GitHub OIDC
  production identity has Contributor only on the web resource group.
- **GitHub Actions:** `CLOUDFLARE_API_TOKEN` lets CI deploy the Worker;
  `CLOUDFLARE_ACCOUNT_ID` selects the account. `VERCEL_TOKEN` lets the other
  workflow deploy to Vercel. These are deployment credentials, not a shared
  store of application environment variables.
- **Cloudflare Worker:** the retained native ARM lifecycle service uses Worker
  bindings in `wrangler.arm-lifecycle.jsonc`; `cloudflare.config.ts` describes
  the legacy full-app deployment. `FEEDBACK_GITHUB_REPO` and
  `FEEDBACK_GITHUB_TOKEN` now belong to Azure only and are removed from this
  Worker. Keep native bindings within Workers Free's 64-variable limit (secrets
  plus text); retained web-only bindings also count. CI uploads `CRON_SECRET`,
  the ARM JSON bundle, and the `STRIPE_BILLING_SECRETS` JSON bundle to the
  Worker on deployment. The ARM canary uses
  the GitHub `CLOUDFLARE_API_TOKEN` for Tunnel/DNS setup. The production Worker's
  binding with that name uses the separate account-owned `codev-arm-runtime`
  token: Cloudflare Tunnel Write on the runtime account and DNS Write restricted
  to the `trycodev.com` zone, plus the preview zone once browser previews are
  enabled (see below). It has no Worker deployment permission.
- **Vercel project:** application environment variables for the Vercel build
  and deployment are configured in Vercel. The deploy workflow pulls the
  selected production or preview environment before building.
- **Durable app workflows on Azure:** `@workflow/world-postgres` stores runs and
  Graphile Worker jobs in dedicated PostgreSQL schemas. CI runs its idempotent
  bootstrap before deployment. `WORKFLOW_POSTGRES_URL` must use the Supabase
  session pooler (5432), not the transaction pooler (6543); workers need LISTEN.
  The dedicated `codev_workflow` login can access only `workflow`,
  `workflow_drizzle`, and `graphile_worker`. Its separate pool avoids exhausting
  the app login during rolling deployments. Two connections and one runner per
  replica keep six replicas within its session limit. Schema bootstrap uses
  `WORKFLOW_POSTGRES_ADMIN_URL` from the CI JSON bundle; that value is excluded
  from the Azure runtime environment. Grant future postgres-owned objects to
  the workflow role through schema-scoped default privileges.
  `WORKFLOW_LOCAL_BASE_URL=http://127.0.0.1:3000` dispatches local queue handlers.
  Cloudflare refuses public workflow handler paths, and the Azure server accepts
  them only from the real process loopback address, even if an external request
  carries the edge credential.
  These schemas are separate from the application migration ledger. Queue startup
  failures retry in the background instead of making the HTTP app fail to load.

Update a runtime variable on the platform serving the affected URL. A change
to one platform's secrets does not update the other. For deployment steps and
credential requirements, see [`OPERATIONS.md`](./OPERATIONS.md).

## Keep this map current

Update this document in the same change whenever a hostname, deployment job,
Worker binding, Cron Trigger, Cloudflare service, Vercel project, or runtime
secret source moves, is added, or is removed. Confirm the new ownership against
the deployment workflows and platform configs before marking it current.

## ARM workspace bridge

For a workspace whose provider is `azure_arm`, the web application sends file,
Git, terminal, agent, Superset, upload, and collaborative file requests to that
workspace's generation-specific `codev-<workspace-hash>-g<generation>.trycodev.com`
tunnel hostname. Each request uses an Ed25519 capability bound to the workspace,
generation, hostname, method, raw path including query, and SHA-256 body digest;
redirects are refused. An unavailable ARM route never falls back to the shared
Firecracker host. Browser sockets still terminate at the authorized web app.

`ARM_WORKSPACE_SIGNING_PRIVATE_KEY` remains in each web deployment's runtime
secret store. The guest receives only the public verification key and tunnel
connector token through protected Azure settings. Private GitHub credentials
stay in the control plane; new guest checkouts receive bounded file snapshots.
The scheduled compute reconciliation route also drains abandoned ARM turns
before idle VM release, using the durable cursor added by migration `0068`.
A candidate image containing `/v1/runtime-activity` and a successful staging
canary are required before ARM member enablement. See the [Phase 4 review](./arm-workspace-free-tier-phase-4.md).

The Worker now has the ARM image, SSH public key, and Ed25519 signing key
bindings. The immutable gallery image pin is managed in the shared ARM runtime
configuration for `codev-arm-workspace-phase1`. Version `1.0.11` remains the
rollback image for the baked-boot rollout. Operator copies of the signing and SSH keys are
stored outside the repository in a private configuration directory.

ARM provisioning requires `ARM_WORKSPACE_AZURE_CLIENT_ID`,
`ARM_WORKSPACE_AZURE_CLIENT_SECRET`, and `ARM_WORKSPACE_RESOURCE_GROUP`.
Firecracker retains `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and
`AZURE_RESOURCE_GROUP`; both providers share the tenant and subscription.
The staging identity `codev-arm-workspace-staging-worker` has the custom
`CoDev ARM Workspace Operator` role only on `codev-arm-workspace-staging`,
and Reader only on the ARM gallery image definition in the build group.
It has no IAM permissions. Its appended client credential expires on
2027-01-03 and must be rotated in the Worker secret store before that date.
A successful staging lifecycle canary is still required before member enablement.

## Free ARM entitlement rollout

`GEN2_FREE_ARM_ENABLED` and `GEN2_FREE_ARM_OWNER_IDS` are non-secret rollout
configuration. Cloudflare declares text bindings from its build environment in
`cloudflare.config.ts`; rebuilding is required to change them. Vercel reads its
project environment. Both default to disabled/empty. No production flag was
changed by Phase 5. Enable an owner allowlist only after migration `0069`, Phase 6
controls, and release gates are ready.

## Agent coordination rollout

`CODEV_AGENT_COORDINATION_WORKSPACES` is a non-secret GitHub repository
variable: comma-separated workspace IDs, or `*`. CI overlays it onto the Azure
origin's runtime values, so changing it needs only a CI deploy from `main`, not
a rewrite of `AZURE_WEB_RUNTIME_SECRETS`. Unset or empty means off. See
[SUPERSET_AGENT_COORDINATION.md](./SUPERSET_AGENT_COORDINATION.md).

`CODEV_SUPERSET_CURSOR_AGENTS_ENABLED` (`true` to enable) is overlaid the same
way. It moves Cursor from native guest turns to Superset agent sessions, so set
it only once no running workspace VM predates an image whose host service
accepts Cursor (ARM image 1.0.17 or later).

A trusted cost collector can POST complete cumulative USD owner/month snapshots
to `/api/gen2/compute/reconcile` using the platform's existing `CRON_SECRET` bearer
credential. The schema requires compute, storage, networking, operations, and
other costs plus an observation timestamp. Do not expose this credential to
members. This ingestion route does not provision a collector: configure one
before enablement. Missing snapshots or snapshots older than 24 hours block free
compute; the existing every-minute cron also shuts down blocked owners' active
workspaces. See the [Phase 5 review](./arm-workspace-free-tier-phase-5.md).

## ARM production finalization

The legacy `codev-runtime-host` Firecracker VM in `CODEV-RUNTIME-MIGRATION`
was retired on 2026-10-05. Its dedicated OS/jailer disks and networking are
removed; ARM workspace disks and infrastructure remain separate. GitHub's
`Deploy runtime (Azure)` workflow is disabled and has no push trigger, so ARM
changes cannot recreate the legacy host. Restoring Firecracker requires an
explicit operator decision before re-enabling that manual workflow.
New paid/admin workspaces use ARM too; paid quota and unlimited admin
entitlements remain unchanged. Free eligibility and second-workspace quota
acknowledgment still apply only to free accounts.

The production ARM resource group is `codev-arm-workspace-production`; staging
canaries keep using `codev-arm-workspace-staging`. The dedicated ARM application
has the existing custom workspace-operator role on the production group, and
GitHub's OIDC deployment identity has Cost Management Reader there.

GitHub secret `ARM_WORKSPACE_RUNTIME_SECRETS` contains the ARM credential/image/
signing/tunnel configuration. The Cloudflare deployment combines it with
`CRON_SECRET` in a private secrets file, so future deploys preserve runtime
settings and keep the Tunnel/DNS token distinct from the CI deployment token.
Cloudflare now verifies production database schema before building/deploying.

GitHub secret `STRIPE_BILLING_SECRETS` contains the six production billing
values documented in [`BILLING.md`](./BILLING.md): the restricted API key,
webhook signing secret, three live price IDs, and portal configuration ID. It
is deployed to Cloudflare as one JSON binding to stay below the Worker variable
limit. Vercel stores the same values as separate production environment
variables; updating one host does not update the other.

`Collect ARM owner costs` runs hourly and by manual dispatch. It pulls the
production DB configuration using the existing Vercel deployment credential,
queries actual Azure resource costs using GitHub OIDC, and POSTs owner snapshots
to the Worker. `ARM_WORKSPACE_COST_TAX_RATE=0` is the operator-confirmed rate.
Unknown charged resource attribution blocks owners; unsupported currencies or
collector failures leave snapshots to expire. Storage includes Azure transaction
meters; historical transferred resources are conservatively charged to each
recorded owner. Azure billing is delayed, so this is a reactive guard, not a
hard billing cap. Invoice-based full-allowance cost acceptance remains separate.

Cloudflare's build reads `GEN2_FREE_ARM_ENABLED` and `GEN2_FREE_ARM_OWNER_IDS`
from GitHub variables. Vercel requires the equivalent production environment
variables. Keep the internal allowlist until lifecycle acceptance is recorded.

### ARM lifecycle dispatch from Vercel

Azure and Vercel have no Cloudflare workflow binding. Azure sets
`ARM_WORKSPACE_WORKFLOW_URL=https://codev-cloudflare-preview.admins-84a.workers.dev/api/gen2/compute/workflow`;
Vercel may use the public route, which Azure forwards to that same bridge. Both
use the shared `CRON_SECRET`. The separate origin prevents a proxy loop. The Worker validates operation parameters and requires its
native `GEN2_ARM_WORKSPACE_LIFECYCLE` binding. Member requests still pass the normal
workspace authorization and entitlement checks before dispatch. Keep the secret
identical in both deployments; the runtime Tunnel/DNS token needs no Workflow
permissions.

ARM runtime configuration and compute service authentication read live Worker
bindings before Node environment values, so secret updates also reach lifecycle
workflow entrypoints. Azure Cost Management may throttle queries; a failed run
publishes no new snapshots and the guard expires stale telemetry.

## ARM guest boot rollout

`ARM_WORKSPACE_BOOT_ENABLED` defaults to false. Its Cloudflare text binding is
built from the matching GitHub repository variable. The production Vercel deploy
synchronizes that flag and the image pin from the shared ARM runtime configuration
into its project environment before pulling/building. Enable it only with a baked image containing cloudflared,
the gateway, and `codev-arm-boot.service`. The controller supplies the saved UUID
or a new UUID before VM deployment. One protected extension configuration starts
local initialization; no guest disk inspection or preparation Run Commands run.
The guest reports signed readiness after the exact disk and bridge are ready.
Disk and tunnel preparation run concurrently with independent replay checkpoints
and a shared Free-plan request budget: each run spends at most 36 of the 50
external subrequests, counting Azure calls twice for a possible sign-in. Azure
operation polling has a five-second minimum and honors `Retry-After`. A baked
start submits the VM deployment without polling it: guest services answer
signed health checks 10-20 seconds before Azure reports the extension. The
controller waits 30 seconds, polls health every 3 seconds (5 after a minute),
and reads the deployment every tenth attempt to surface failures. Legacy starts
still poll the deployment to completion. Provisioning status includes this setup time.

Roll back new starts by disabling the flag and setting the previous immutable
image as the pin. Existing VMs keep their current image and disk.

Cloudflare collaboration WebSockets retain initialization through `waitUntil`.
Each socket has its own Redis connection and room reader; each document message
opens and closes its own Hyperdrive pool after the operation completes. These
resources must not be reused across Worker requests or closed with the upgrade
HTTP response. Vercel keeps its process-scoped Redis and Postgres clients.

Workspace Cursor turns use the initiating member’s existing encrypted CLI
subscription or API key. No additional Worker or Vercel secret is required.
The ARM image includes pinned `cursor-agent` for Linux ARM64; auth and config
directories are isolated per turn under private agent profiles.

ARM image `1.0.13` adds Cursor CLI `2026.10.01-e373342`. The production image
pin is the `ARM_WORKSPACE_IMAGE_VERSION_ID` repository variable when it is set,
otherwise the value in `ARM_WORKSPACE_RUNTIME_SECRETS`. Promote or roll back with
`gh variable set ARM_WORKSPACE_IMAGE_VERSION_ID`, then run the CI and Deploy web
workflows on `main`; the Azure deploy rejects an ID outside a lowercase
`codev-arm-workspace-*` gallery. Saved workspace disks survive image upgrades.
`CODEX_CATALOG_CLIENT_VERSION` must equal the promoted image's Codex pin.
ChatGPT's catalog lists only models that version can run. Releases set both
variables together (see `infra/azure/README.md`). Without it, the catalog uses
the version in `codex-account-models.ts`.

Workspace model discovery uses connected member credentials and account catalogs;
caching is scoped to the member and credential. Cursor and Claude discovery runs
on the requesting web host. ChatGPT rejects catalog requests from Worker egress,
so Codex discovery uses `POST https://codev-co-dev-admins.vercel.app/api/gen2/providers`
with the existing shared `CRON_SECRET`. The service accepts only member identity
and Codex provider selection, resolves credentials on Vercel, and returns model
metadata. It refuses requests without service authorization and refuses execution
on Workers to prevent relay loops. No new secrets or paid Cloudflare services are
required; keep that Vercel production alias available and deploy Vercel before
enabling a Worker build that depends on the catalog service.

## Browser previews

The workspace Browser tab frames a member's dev server from a separate
registrable domain, never from an app host. `CODEV_PREVIEW_ZONE` (the zone
name) and `CODEV_PREVIEW_ZONE_ID` (its Cloudflare zone ID) are non-secret
GitHub repository variables. CI overlays them onto the Azure origin through
`infra/azure/deploy-web.mjs`. Both must be valid or previews stay off, and
a zone equal to or under `trycodev.com` is refused: a subdomain would be
same-site with the app and receive its SameSite cookies. Sessions are minted
only for pages on `trycodev.com` or `www.trycodev.com` (localhost outside
production), which the guest allows as the frame ancestor, so leave the
variables unset on Vercel. The lifecycle Worker needs neither variable.
In local development, `CODEV_PREVIEW_DEV_DIRECT=1` frames
`http://localhost:<port>` directly instead.

Each preview host is `p<port>-<sha256(workspace)[0:20]>-g<generation>.<zone>`:
one origin per port, one level deep so Universal SSL covers it, and gone with
the generation. Minting a session (`POST /api/gen2/workspaces/<id>/preview`,
editors only, 30 per minute per member and workspace, never for the guest's
reserved ports) adds a `*.<zone>` → `http://127.0.0.1:5261` rule before the
tunnel's catch-all on first use and creates a proxied CNAME to the tunnel,
keeping at most four hosts per generation. The rule is added only after a
guest exec shows systemd (uid 0) owns `127.0.0.1:5261`, so a busy guest
cannot open its first preview until it answers; once present, the rule
vouches for that generation on every replica. A tunnel whose ingress lacks
its gateway host is never rewritten. These calls run from the web app with
the ARM runtime Cloudflare token, never in the lifecycle Workflow, so its
request budget is unchanged. That token is shared with workspace starts, so
sessions that need Cloudflare work are also limited to 10 per minute per
member across workspaces. The every-minute reconcile route deletes preview
records whose workspace generation is no longer ready (at most once every
five minutes per replica, 20 deletes per run). Records left behind after
previews are turned off point at deleted tunnels and can be removed by hand.

The session URL carries a 60-second, single-use Ed25519 token signed with
`ARM_WORKSPACE_SIGNING_PRIVATE_KEY`: `scope: "preview"`, `aud` the exact
preview host, the port, member, workspace, generation, a `jti`, and the
framing app origin. Gateway capabilities and preview tokens never verify for
each other. The guest preview proxy, which ships only in a signed ARM image,
redeems it for a partitioned `__Host-codev-preview` cookie. Port listing reads
`/proc/net/tcp{,6}` through the guest exec without counting as member
activity. A preview is available only when `ARM_WORKSPACE_BOOT_ENABLED` is on
and systemd (uid 0) owns `127.0.0.1:5261`; other guests show "Update this
workspace to use the browser". Preview traffic never keeps a workspace
awake; while the browser window has focus, a focused preview reports member
input from the page for at most 30 minutes after focus entered it.

The app CSP adds `frame-src 'self' https://*.<zone>` only when the zone is
configured (development also allows localhost); `frame-ancestors 'none'` and
`X-Frame-Options: DENY` are unchanged. `Permissions-Policy` allows the app's
own microphone for dictation; previews are framed with an empty `allow` list.

Cloudflare requirements for the zone: the same account as the runtime
tunnels; a plan with enough DNS records (zones created on Free after
2024-09-01 allow 200; Pro allows 3,500); a Cache Rule that bypasses cache for
the whole zone, as defense in depth behind the proxy's
`Cloudflare-CDN-Cache-Control: no-store`; no Worker routes; and DNS Write on
the zone for the `codev-arm-runtime` token. Lower the zone's SOA record
minimum TTL (DNS settings) to 60 seconds: the frame loads a host moments
after its CNAME is created, and a resolver that asks before the record
reaches every Cloudflare nameserver caches the miss for that TTL (1,800
seconds by default). Until the zone is on the Public Suffix List, previews
of different workspaces are same-site with each other.

Roll out in this order:

1. Deploy the web app without the variables; previews stay inert.
2. Release a guest image with the preview proxy through **Release ARM
   workspace image** (`release-arm-image.yml`).
3. Promote it with `ARM_WORKSPACE_IMAGE_VERSION_ID` and the matching
   `CODEX_CATALOG_CLIENT_VERSION`.
4. Grant the `codev-arm-runtime` token DNS Write on the preview zone, add
   the zone's Cache Rule, and lower its SOA minimum TTL.
5. Set the `CODEV_PREVIEW_ZONE` and `CODEV_PREVIEW_ZONE_ID` repository
   variables.
6. Start a new CI run from `main`; a queued run deploys the old values.

Existing VMs keep their image until they restart on the promoted one. To turn
previews off, clear the variables and start a new run.

## Browser security and session rollout

Azure and Vercel web deployments generate a fresh CSP script nonce in `apps/web/proxy.ts`
and forward it to SSR. The root layout reads that nonce for the theme script;
framework bootstrap scripts inherit it from the request CSP. All pages must
remain dynamically rendered so a cached page cannot reuse another request's
nonce. The shared Next.js headers add framing protection, MIME sniffing
protection, referrer and permissions policies, and production HSTS. HSTS is
host-only: runtime subdomains do not inherit the application's policy. CSP
allows the canonical public app origin for admin link prefetch redirects and
OAuth form returns; runtime and arbitrary sibling origins remain excluded.

Production sessions use `__Host-codev.session-token` with no `Domain` attribute.
Public, admin, preview, and runtime hosts cannot share this cookie. Visiting an
application host expires the previous domain-wide session cookies; this rollout
requires members to sign in again. The admin host keeps its own session; the
public sidebar's Admin link goes through `/api/auth/admin-handoff`, which signs
a one-minute, single-use ticket for current administrators. The admin host
redeems it (through REST Redis `SET NX`, or the `REDIS_URL` limiter) after rechecking admin status and credential
revision, then sets its own host-only cookie. Azure releases omit `AUTH_URL`/`NEXTAUTH_URL` from the runtime so
Auth.js retains the authenticated public host. The existing
`AUTH_REDIRECT_PROXY_URL` on `www.trycodev.com/api/auth` keeps the registered
provider callback canonical and forwards signed OAuth state back to the host
starting sign-in. Keep that redirect proxy and the shared `AUTH_SECRET` intact.

Password login allows ten attempts per normalized account per fifteen minutes,
including server-action requests. It uses the existing REST Redis settings
(`KV_REST_API_URL`/`KV_REST_API_TOKEN`, or the Upstash equivalents), with
`REDIS_URL` as a fallback. Missing or failing production rate-limit storage
rejects password login. Password changes invalidate browser sessions, retire
CLI tokens and approved device flows atomically, and close existing workspace
sockets within fifteen seconds. No database migration is required.

The Azure edge replaces `x-forwarded-for` with Cloudflare’s client IP and strips
caller-supplied `x-vercel-forwarded-for`. CLI device login throttling uses the
trusted `x-forwarded-for` header on both hosting paths.

Browser API mutations using session cookies require an exact matching Origin,
including for handlers outside the shared route wrapper. Auth.js token-validated
flows and signed Stripe webhooks keep their existing authentication. CLI bearer
requests remain supported on explicitly enabled routes.

Password-reset links default to `https://www.trycodev.com` in production when no
explicit Auth.js or Vercel URL is available; development retains localhost.

`AUTH_SECRET` also signs reusable workspace invitation capabilities on each web
host. Keep it consistent across hosts. Invitation hashes remain in the database;
opening sharing does not rotate active links or extend their seven-day expiry.
