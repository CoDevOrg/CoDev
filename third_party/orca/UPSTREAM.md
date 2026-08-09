# Orca IDE (vendored web client)

- Upstream: https://github.com/stablyai/orca
- Version: v1.4.176 (tag `v1.4.176`, commit `02cea8a`)
- License: MIT (see `LICENSE` in this directory)

## What is vendored

`apps/web/public/orca/` contains the **unmodified** production build of Orca's
official browser web client, built from the upstream tag with:

```bash
pnpm install --ignore-scripts
npx vite build --config vite.web.config.ts   # outputs out/web/
```

The bundle is served statically by the CoDev web app at `/orca/web-index.html`
and boots from a `#pairing=<base64url offer>` URL fragment. No Orca source was
modified.

## Matching server runtime

The Orca runtime server (`orca serve`, same v1.4.176 AppImage,
`orca-linux-arm64.AppImage`) runs on the CoDev Firecracker EC2 host as the
`orca-serve.service` systemd unit, fronted by Caddy TLS at
`https://3-21-99-52.nip.io`. Keep the vendored web client and the host AppImage
on the same upstream version when upgrading either.
