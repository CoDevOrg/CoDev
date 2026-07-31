# CoDev Hocuspocus service

This service hosts the Yjs WebSocket rooms used by the browser workspace. It
persists document state in Postgres and uses signed workspace tokens issued by
the Next.js application. Hocuspocus awareness carries collaborator presence
and Monaco cursor state.

Required environment:

- `DATABASE_URL` or `POSTGRES_URL` — Postgres connection for Yjs documents.
- `HOCUSPOCUS_TOKEN_SECRET` — at least 32 bytes, shared with `apps/web`.
- `PORT` — optional, defaults to `8787`.

Run it locally with:

```sh
pnpm --filter @codev/hocuspocus-server dev
```

Configure the browser with `NEXT_PUBLIC_HOCUSPOCUS_URL`, for example
`ws://localhost:8787`. In production, expose the service through a WebSocket-
capable load balancer and use the `wss://` endpoint in that variable.

The service is a Node process and does not require Docker. If a local
container is needed for development, use Apple's open-source `container` tool
as required by the repository guidance.
