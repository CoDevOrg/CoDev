# Web hosting: Cloudflare and Vercel

The public web app has moved from Vercel to Cloudflare Workers. `apps/web` still
deploys to both platforms: Cloudflare serves the `trycodev.com` hostnames, while
Vercel retains its own production and preview deployments. Check the hostname
and deployment job before changing a setting; the deployments have separate
runtime secrets.

|                       | Cloudflare                                                                                             | Vercel                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Serves                | The production Worker on `trycodev.com` and `www.trycodev.com`, plus the `admins.trycodev.com/*` route | The `codev` web project on Vercel deployment URLs; `main` gets a production deployment and other branches get previews       |
| Built and deployed by | The **CI** workflow on `main`: `vite build`, then `cf deploy --prebuilt`                               | The **Deploy web** workflow on web-related pushes: `vercel pull`, `vercel build`, then `vercel deploy --prebuilt`            |
| App configuration     | [`apps/web/cloudflare.config.ts`](../apps/web/cloudflare.config.ts) and Worker bindings/secrets        | [`vercel.json`](../vercel.json), [`apps/web/vercel.json`](../apps/web/vercel.json), and Vercel project environment variables |
| Database access       | `HYPERDRIVE` binding to PostgreSQL                                                                     | `POSTGRES_URL` from the Vercel environment                                                                                   |

The Cloudflare Worker runs the Next.js app through vinext. It handles Gen 2
collaboration and terminal WebSocket upgrades, runs the every-minute compute
reconciliation Cron Trigger, and uses Hyperdrive for PostgreSQL. The ARM
workspace canary also creates Cloudflare Tunnels and DNS records for runtime
hostnames; the Firecracker guests themselves run in Azure. See
[`cloudflare-worker.ts`](../apps/web/lib/platform/cloudflare-worker.ts) and
[`arm-workspace-tunnel.mjs`](../infra/azure/arm-workspace-tunnel.mjs).

## Where credentials go

- **GitHub Actions:** `CLOUDFLARE_API_TOKEN` lets CI deploy the Worker;
  `CLOUDFLARE_ACCOUNT_ID` selects the account. `VERCEL_TOKEN` lets the other
  workflow deploy to Vercel. These are deployment credentials, not a shared
  store of application environment variables.
- **Cloudflare Worker:** application secrets are Worker bindings declared in
  `cloudflare.config.ts` and configured on Cloudflare. The `CRON_SECRET` GitHub
  secret is uploaded to the Worker by CI on deployment. The ARM canary uses
  the GitHub `CLOUDFLARE_API_TOKEN` for Tunnel/DNS setup.
- **Vercel project:** application environment variables for the Vercel build
  and deployment are configured in Vercel. The deploy workflow pulls the
  selected production or preview environment before building.

Update a runtime variable on the platform serving the affected URL. A change
to one platform's secrets does not update the other. For deployment steps and
credential requirements, see [`OPERATIONS.md`](./OPERATIONS.md).

## Keep this map current

Update this document in the same change whenever a hostname, deployment job,
Worker binding, Cron Trigger, Cloudflare service, Vercel project, or runtime
secret source moves, is added, or is removed. Confirm the new ownership against
the deployment workflows and platform configs before marking it current.
