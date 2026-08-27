# Orca IDE (vendored web client)

- Upstream: https://github.com/stablyai/orca
- Version: v1.4.176 (tag `v1.4.176`, commit `02cea8a`)
- License: MIT (see `LICENSE` in this directory)

## What is vendored

`apps/web/public/orca/` contains CoDev's production build of Orca's official
browser web client. The upstream source is pinned, verified, and patched with
[`infra/aws/orca-build/codev-web.patch`](../../infra/aws/orca-build/codev-web.patch)
before it is built. Rebuild it reproducibly with:

```bash
pnpm orca:web
```

The bundle is served statically by the CoDev web app at `/orca/web-index.html`.
The build script checks the exact upstream commit, applies the patch with
`git apply --check`, runs Orca's web typecheck/build, applies deterministic
CoDev branding, and replaces the vendored output.

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

### Native project bootstrap and GitHub repository picker

`ensureOrcaSession` (`apps/web/lib/orca-host.ts`) has `codev-orchestrator`
clone the workspace repository directly (see
[`services/orchestrator/src/backend/orca.rs`](../../services/orchestrator/src/backend/orca.rs))
onto the runtime host at a fixed, predictable path (`orcaWorkspacePath()` in
`apps/web/lib/orca-pairing.ts`, `/srv/codev/workspaces/<workspaceId>`).
The CoDev patch adds an explicit bootstrap contract to the pairing fragment:
`codev=1`, `codevProject`, and `codevProjectKind`. Orca accepts only the exact
`/srv/codev/workspaces/<UUID>` path shape, waits for its normal session
hydration, then invokes its typed `addRepoPath` runtime action directly. The
pairing credential and bootstrap data remain in the URL fragment, so neither
is sent in HTTP requests, proxy logs, or referrers.

In CoDev-embedded mode, Orca's own Add Project action sends the parent a
same-origin `codev:choose-repository` message. The parent verifies both the
message origin and the exact iframe window before showing all repositories
from the user's existing authenticated GitHub installations. Choosing one
creates and opens its dedicated CoDev workspace. GitHub credentials remain
server-only and never cross the iframe bridge.

### Default chat tab (agent-first workspace)

Stock Orca opens a worktree on an idle terminal tab. CoDev workspaces are
agent-first, so the CoDev patch (`src/renderer/src/web/codev-default-chat-tab.ts`,
wired from `codev-project-bootstrap.ts` and `App.tsx`) opens the workspace's
default checkout onto a **native chat tab** instead: right after the default
checkout becomes the active worktree, it calls Orca's own
`launchAgentInNewTab` (the same path the tab-bar quick-launch uses, so paired
web-runtime sessions spawn the agent on the host correctly) with
`promptDelivery: 'draft'` — the composer opens empty and editable, nothing is
auto-submitted. It runs once per project handoff and is a no-op when the
worktree already has an agent tab (a reload that mirrored a running session).
It also retires the stock terminal tab(s) that existed before the launch
(deferred, and never the worktree's last tab) so the workspace opens on the
chat tab alone.
The agent is `claude` by default; the parent can pin `claude` or `codex`
through a new `codevDefaultAgent` pairing-fragment param
(`buildOrcaIframeSource` → `readCodevBootstrap` → `window.__CODEV_DEFAULT_AGENT__`),
which `WorkspaceHome` sets from the member's linked provider.

What makes that launched tab render as chat is `experimentalNativeChat` /
`openAgentTabsInChatByDefault`. The patch forces both **on** in
`getStoredSettings()` (`web-preload-api.ts`) whenever `isCodevEmbedded()` —
so a browser that ran an earlier CoDev build, or any unrelated `settings.set()`
that re-persisted the upstream `false` default, cannot leave the workspace
showing a raw agent TUI. `isCodevEmbedded()` reads `window.__CODEV_EMBEDDED__`
and falls back to the `codev=1` fragment for callers that run before
`web/main.tsx` sets the flag. This replaced the earlier, defeatable
one-shot `codev-preload.js` localStorage seed.

The launched agent CLI also has to come up *past its own first-run wizard*,
which the chat surface cannot drive. `seed_claude_config` in
[`services/orchestrator/src/backend/orca.rs`](../../services/orchestrator/src/backend/orca.rs)
writes the workspace Linux user's Claude Code config before `orca serve`
starts — two files, because the CLI splits them (verified against the CLI's
own on-disk state at v2.1.236): `~/.claude.json` carries
`hasCompletedOnboarding` and the per-project `hasTrustDialogAccepted`, and
`~/.claude/settings.json` carries `theme`. Both are merged non-destructively,
so a member who later runs `claude` in a terminal keeps their own choices;
only `hasTrustDialogAccepted` for this workspace's own clone directory is
forced, since it gates a prompt the chat surface can never answer.
`bypassPermissionsModeAccepted` is deliberately **not** seeded — pre-accepting
a permissions bypass is a security decision, not a first-run annoyance.

A CoDev-only **provider picker** (`CodevChatProviderPicker`, rendered by
`NativeChatComposerActions` beside the model/reasoning-effort pickers) lets the
member switch the chat tab between Claude and Codex. Because each chat tab runs
one agent CLI in its PTY, a switch (`src/renderer/src/web/codev-chat-provider-switch.ts`)
starts a fresh chat on the new provider in the same worktree via
`launchAgentInNewTab` and, after a short delay so the paired-host tab mirror
can land, retires the previous tab — skipping that retirement if it would
leave the worktree with no tab.

Model and reasoning-effort pickers for `codex`/`claude` come from the existing
`NativeChatSessionOptionPickers` patch. Stock Orca only builds that picker
surface once a tab has a live PTY (`use-native-chat-session-options.ts`
returned `null` while `targetPtyId` was absent, since a pre-PTY pick could not
reach the already-queued startup command). CoDev opens the default chat tab
with an empty composer *before* the paired host's PTY mirrors, so the patch
lifts that guard when `isCodevEmbedded()`: the surface is built in `'draft'`
mode from the catalog defaults so the model/effort pills are visible from
first paint, then re-created in `'live'` mode once the PTY arrives, which
reconciles any pre-PTY selection through the agent's own picker.

## Branding patches (modify the vendored bundle directly)

Unlike the theme bridge above, these edits touch files inside
`apps/web/public/orca/` directly. They are reapplied automatically by
`infra/aws/orca-build/brand-web.mjs` during `pnpm orca:web`.

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
  plus `codev-preload.js` loaded before the app's module script (classic
  scripts run synchronously during HTML parsing,
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

`orca serve` (Orca's Electron main process / IDE backend) is a full
MIT-licensed part of the same `stablyai/orca` monorepo as the vendored web
client above — it is not a closed-source binary. CoDev builds it from that
real source at the same pinned tag/commit as the vendored web client,
instead of downloading upstream's prebuilt `orca-linux-arm64.AppImage`
release asset:

- [`infra/aws/orca-build/Containerfile`](../../infra/aws/orca-build/Containerfile)
  clones `stablyai/orca` at the pinned tag, verifies the resolved commit,
  and runs its own `pnpm run build:linux -- --arm64` (electron-builder),
  then self-extracts the packaged AppImage into a plain `squashfs-root/`
  directory.
- [`infra/aws/scripts/build-orca-serve.sh`](../../infra/aws/scripts/build-orca-serve.sh)
  runs that build in an arm64-native Linux container via Apple's `container`
  tool and produces a checksum-pinned `orca-serve-linux-arm64.tar.gz`
  artifact, uploaded to S3 by `infra/aws/deploy.sh` alongside the
  orchestrator/guestd binaries.

On the CoDev Firecracker EC2 host, `codev-orchestrator` spawns, tracks, and
reaps **one dedicated `orca serve` process per workspace** — not a single
shared systemd unit — each with its own Linux user, loopback port, and
`/srv/codev/workspaces/<workspaceId>` clone directory (see
[`services/orchestrator/src/backend/orca.rs`](../../services/orchestrator/src/backend/orca.rs)).
Caddy fronts all sessions on one public TLS endpoint (a `nip.io` hostname
derived from the host's own current public IP) and path-routes
`/w/<workspaceId>/*` to the matching session's port; the orchestrator updates
that routing over Caddy's local admin API on every session start/stop. Keep
the vendored web client and this build's `ORCA_REF`/`ORCA_COMMIT_PREFIX` on
the same upstream version when upgrading either.
