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
and boots from a `#pairing=<base64url offer>` URL fragment. Aside from the
minimal, explicitly documented branding patches below, no Orca source was
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

## Branding patches (modify the vendored bundle directly)

Unlike the theme bridge above, these edits touch files inside
`apps/web/public/orca/` directly. **Re-vendoring from upstream (re-running the
`vite build` above) will silently drop them — reapply this section after any
rebuild.**

- `assets/logo-BVyJvfne.js` — the single module that exports Orca's orca-mark
  SVG data URI (consumed by the sidebar, Landing screen, onboarding, and
  Settings header). Its export shape (`var e=\`data:...\`;export{e as t};`) is
  preserved; only the data URI content was swapped for a small CoDev mark, so
  every consumer picks up the new logo without touching each call site.
- `assets/web-index-Cyb9jzml.js` — the bundled English i18n resource string
  for key `520304a067` ("Orca logo" alt text) was changed to "CoDev logo".
  Non-English locale bundles were left untouched.
- `web-index.html` — `<title>` changed from "Orca Web" to "CoDev Workspace",
  plus two plain (non-module) inline `<script>` tags added before the app's
  module script (classic scripts run synchronously during HTML parsing,
  before deferred `type="module"` scripts — this ordering is what makes both
  patches below effective):
  1. A property trap on `window.api` so that the instant the preload API is
     assigned, `starNag.onShow`/`starNag.onHide` are replaced with no-ops.
     `StarNagCard` / `StarNagToastHost` subscribe to those during their first
     render effect, so patching after the app boots is too late to stop an
     already-registered subscription. This silences Orca's "star us on
     GitHub" nag card and toast everywhere except the always-rendered
     Landing-page button, which has no event to intercept and is instead
     hidden via CSS in `orca-theme-overrides.css`
     (`button[class*="border-amber-500/6*"]`, scoped to that button's exact
     Tailwind classes).
  2. Seeds `showMobileButton: false` into the `orca.web.settings.v1`
     localStorage key the app reads on boot, but only when the key is
     entirely absent. `showMobileButton` is browser-local-only (never synced
     with a paired remote host — see `getRuntimeBackedStoredSettings`'s
     field allowlist in `web-preload-api.ts`), so this is both correct and
     sufficient to default the "Orca Mobile" sidebar shortcut off on first
     run. Calling `window.api.settings.set()` after the iframe's `load`
     event fires (i.e. from `orca-workspace.tsx`) is too late to affect
     first paint — confirmed by manual testing, the already-rendered
     sidebar does not react to a settings change made outside its own
     Zustand store — which is why this lives here instead. Only filling in
     an absent key, rather than force-setting it every load, means a user
     who re-enables it from Settings keeps that choice on their next visit;
     this is a default, not a hard block, since CoDev's own mobile pairing
     UX is deferred to a later milestone.

## Matching server runtime

The Orca runtime server (`orca serve`, same v1.4.176 AppImage,
`orca-linux-arm64.AppImage`) runs on the CoDev Firecracker EC2 host as the
`orca-serve.service` systemd unit, fronted by Caddy TLS at
`https://3-21-99-52.nip.io`. Keep the vendored web client and the host AppImage
on the same upstream version when upgrading either.
