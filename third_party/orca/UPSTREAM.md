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

## Theme bridge (first-party)

CoDev applies its unified workspace palette to Orca's chrome via a separate,
first-party stylesheet:

- File: `apps/web/public/orca-theme-overrides.css`
- Injected at runtime into the Orca iframe by `apps/web/components/orca-workspace.tsx`
  (same-origin `<link>` append on iframe load)

This bridge is **not** part of the vendored Orca build and lives outside
`third_party/orca/` / `apps/web/public/orca/`. It retints shell surfaces and
amber accents toward CoDev's deep-green / burnt-orange palette while leaving
Monaco editor, terminal, and diff-viewer regions alone.

Re-check the override selectors after any Orca version bump — they target the
compiled Tailwind class names from the current bundle and are not guaranteed
stable across upstream rebuilds.

## Matching server runtime

The Orca runtime server (`orca serve`, same v1.4.176 AppImage,
`orca-linux-arm64.AppImage`) runs on the CoDev Firecracker EC2 host as the
`orca-serve.service` systemd unit, fronted by Caddy TLS at
`https://3-21-99-52.nip.io`. Keep the vendored web client and the host AppImage
on the same upstream version when upgrading either.
