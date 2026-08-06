# Eclipse Theia workspace architecture

CoDev uses Eclipse Theia as the IDE framework for its hosted collaborative workspaces. Theia replaces the previous custom Monaco, file explorer, terminal, search, and source-control implementation; CoDev remains the product shell and control plane.

## Responsibility boundary

- The Next.js application on Vercel owns authentication, authorization, workspace lifecycle, sharing, agent sessions, reviews, publishing, and the outer workspace UI.
- One Theia browser backend runs inside each Firecracker microVM beside `/workspace`. It owns editor-facing filesystem, terminal, task, search, SCM, and VS Code extension services.
- The static Theia frontend is built during the Vercel build and served from `/theia/index.html`. It contains no credentials or workspace data.
- Theia's Socket.IO polling traffic is authenticated by the Next.js route, IAM-signed to the AWS orchestrator, carried over Firecracker vsock, and forwarded only to `127.0.0.1:3000` inside the guest.
- The CoDev agent panel stays outside Theia. Agent credentials remain server-only and durable agent state remains in CoDev instead of being duplicated in Theia preferences.

## Security properties

- The microVM does not expose a public Theia port.
- The proxy accepts only Theia bootstrap and Socket.IO paths and only fixed GET/POST methods.
- Vercel checks workspace edit permission before opening an IDE transport.
- Only Theia's connection-token cookie is forwarded into the guest; CoDev authentication cookies are not.
- Workspace trust remains enabled, and the guest keeps its existing Firecracker and systemd isolation.

## Build and deployment

`apps/web` builds the production Theia frontend before `next build` and copies it into its ignored `public/theia` build directory. The AWS release script uploads a source bundle. The ARM64 host bootstrap builds and deploys the matching Theia backend and native modules into the base guest image, then starts it through `codev-theia.service`.

The initial transport deliberately uses Socket.IO HTTP polling because it works through the existing authenticated Vercel and API Gateway request path. A WebSocket tunnel can be added later as a compatible performance optimization.
