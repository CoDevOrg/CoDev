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

`apps/web/components/orca-workspace.tsx` also renders a first-party
`workspace-topbar` strip above the iframe (not inside it) with a persistent
"← CoDev" link back to `/dashboard`. It's parent-page chrome, not a patch to
the vendored bundle, so it survives re-vendoring untouched and needs no
reapplication.

### Auto-opening the cloned workspace repository

`ensureOrcaWorkspaceClone` (`apps/web/lib/orca-host.ts`) clones the workspace
repository onto the runtime host at a fixed, predictable path
(`orcaWorkspacePath()` in `apps/web/lib/orca-pairing.ts`,
`/srv/codev/workspaces/<workspaceId>`), but Orca has no URL parameter or
`postMessage` API for opening a project on boot — the pairing fragment only
carries the connection offer. `autoAddOrcaProject` in
`apps/web/components/orca-workspace.tsx` closes that gap by driving Orca's
own "Add a project" dialog exactly as a person would (confirmed by
inspecting the live client's DOM): open the icon "Add Project" button,
switch the host picker off "Local Mac" onto whichever host is `Connected`,
"Browse folder", type the cloned path, "Select folder", then confirm "Add
Git Project" on the follow-up dialog Orca shows for a path that resolves to
a real git repository. It only runs when Orca is showing its empty "Add a
project to get started" state, so it's a no-op once a project is already
open.

This reaches through the DOM rather than Orca's internal Zustand
store/RPC layer (`addRepoPath`, the `$()` dispatcher) because those aren't
reachable from a script injected into the iframe from the outside — nothing
in the bundle exposes the store on `window`. It's therefore best-effort like
the theme bridge above: any renamed button label, changed dialog structure,
or added confirmation step just times out and aborts silently, leaving
Orca's own "Add Project" button as the manual fallback. Re-check the
selectors and step sequence in `autoAddOrcaProject` after any Orca version
bump.

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
- `assets/*.js` (every non-locale chunk, ~70 files including the main
  `web-index-Cyb9jzml.js` entry bundle) — every English-language, capitalized
  whole-word occurrence of `Orca`/`ORCA` in the bundled i18n strings was
  replaced with `CoDev`/`CODEV` via a scripted pass (word-boundary substring
  replace, restricted to files outside the `es-*`/`ja-*`/`zh-*`/`ko-*` locale
  bundles, which were intentionally left in their original language). This
  covers both the central resource dictionary in the main bundle and the
  per-component fallback default strings baked into each lazy-loaded route
  chunk (Orca's `translate(key, fallbackText)` call sites carry their own
  literal fallback at every usage site, not just in the dictionary). A
  follow-up pass fixed the resulting "an CoDev" → "a CoDev" article mismatch
  (Orca starts with a vowel sound, CoDev doesn't) everywhere it appeared. All
  727 asset files were `node --check`-verified afterward to confirm no syntax
  was broken.

  Deliberately **not** touched — genuine technical identifiers that name
  real, still-functioning artifacts rather than pure brand mentions, all of
  which happen to be written lowercase in the source (so the case-sensitive
  `Orca`/`ORCA` replace never matched them): the `orca.yaml` project-config
  filename, the `~/.orca` config directory, the `orca://pair?code=` URL
  scheme, the literal `orca`/`orca-cli` CLI binary name and its PATH
  registration strings, terminal-tab-title examples like `orca · zsh`, the
  `github.com/stablyai/orca` upstream repo URL, and the `Orca Nerd Font
Symbols` `@font-face` family name in the CSS bundle (renaming that alone
  would silently break Nerd Font glyph rendering in the terminal, since
  nothing else in the bundle references it by a new name). Renaming the
  _display text_ for these would mislead users into looking for a `codev`
  command or a `codev.yaml` file that doesn't exist — the underlying Orca CLI
  binary and config-file conventions are unchanged.

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
     localStorage key the app reads on boot, gated on a first-party
     `codevMobileDefaultApplied` marker stored in that same object rather
     than on `showMobileButton`'s mere presence. `showMobileButton` is
     browser-local-only (never synced with a paired remote host — see
     `getRuntimeBackedStoredSettings`'s field allowlist in
     `web-preload-api.ts`), so seeding it client-side is correct, but
     `window.api.settings.set()` (in `web-preload-api.ts`) always persists
     the _entire_ merged settings object — `getStoredSettings()` defaults
     included — on every call, not just the field being changed. That means
     any unrelated settings write (dismissing the onboarding checklist,
     opening Automations, etc.) silently bakes the upstream default of
     `showMobileButton: true` into storage, which would permanently defeat
     a plain "set only if the key is absent" check. The marker makes the
     CoDev default-off apply exactly once per browser regardless of what
     else has already been written, then leaves any later state (default or
     an explicit Settings toggle) alone for good. Calling
     `window.api.settings.set()` after the iframe's `load` event fires (i.e.
     from `orca-workspace.tsx`) is too late to affect first paint —
     confirmed by manual testing, the already-rendered sidebar does not
     react to a settings change made outside its own Zustand store — which
     is why this lives here instead. This is a default, not a hard block,
     since CoDev's own mobile pairing UX is deferred to a later milestone.

## Matching server runtime

The Orca runtime server (`orca serve`, same v1.4.176 AppImage,
`orca-linux-arm64.AppImage`) runs on the CoDev Firecracker EC2 host as the
`orca-serve.service` systemd unit, fronted by Caddy TLS at
`https://3-21-99-52.nip.io`. Keep the vendored web client and the host AppImage
on the same upstream version when upgrading either.
