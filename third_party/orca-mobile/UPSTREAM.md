# Orca Mobile (vendored transport + terminal source)

- Upstream: https://github.com/stablyai/orca
- Version: v1.4.176 (tag `v1.4.176`, commit `02cea8a`) — kept in lockstep
  with `third_party/orca/UPSTREAM.md`'s web client pin
- License: MIT (see `LICENSE` in this directory)

## What is vendored

`apps/mobile/src/vendor/orca/` contains a source-level subset of Orca's
official native mobile app, copied verbatim from the upstream commit above
with the exact upstream relative directory layout preserved
(`mobile/src/transport/`, `mobile/src/terminal/`, `mobile/src/theme/`,
`mobile/src/storage/`, `src/shared/`) so every relative import between
vendored files resolves unmodified. Nothing is hand-rewritten or
reimplemented — this is the real pairing/E2EE/RPC client and the real
xterm-in-WebView terminal renderer Orca ships.

Only the transitive dependency closure of two entry points is vendored:

- `mobile/src/transport/pairing.ts` + `mobile/src/transport/rpc-client.ts`
  — pairing-offer decoding, the NaCl E2EE handshake, and the JSON-RPC/binary
  terminal-stream client.
- `mobile/src/terminal/TerminalWebView.tsx` — the xterm WebView terminal
  component.

Deliberately **not** vendored: Orca's LAN/Tailscale host-discovery and
multi-host management layer (`mobile-relay-*`, `host-catalog-*`,
`host-store`, `pairing-keychain`, etc.), the QR-scan pairing screens
(`app/pair*.tsx`), voice dictation, and the worktree/source-control/files
screens (a later milestone — see the CoDev implementation plan this was
vendored for). CoDev pairs to its own always-on per-workspace `orca serve`
runtime directly, so the host-discovery/relay layer has no CoDev equivalent
to connect to and was excluded rather than adapted.

Most of `src/shared/` in this vendor is `import type`-only — Orca's central
`src/shared/types.ts` type-definition file is transitively referenced for
type-checking but compiles away entirely; it carries no runtime/bundle cost.

## Regenerating

The pinned file list was produced by tracing the real import graph from the
two entry points above (no manual trimming of reachable files). To
re-vendor after a version bump:

1. Clone `stablyai/orca` at the new tag.
2. Re-run the same closure trace from the two entry points against
   `mobile/src/transport/pairing.ts`, `mobile/src/transport/rpc-client.ts`,
   and `mobile/src/terminal/TerminalWebView.tsx`.
3. Copy the resulting file list into `apps/mobile/src/vendor/orca/`,
   preserving the exact upstream relative paths.
4. Re-run `pnpm --filter @codev/mobile postinstall` (or
   `node apps/mobile/scripts/build-terminal-webview-engine.mjs` directly) to
   regenerate `terminal-webview-engine.generated.ts` against the currently
   installed `@xterm/*` package versions.
5. `pnpm --filter @codev/mobile typecheck` and re-verify the CoDev-specific
   pairing bridge (`apps/mobile/src/lib/orca-session.ts`) still compiles
   against `mobile/src/transport/types.ts`'s `PairingOffer`/RPC shapes.

## CoDev-specific integration (first-party, not part of the vendor)

- `apps/mobile/src/lib/orca-session.ts` — fetches a pairing offer from
  CoDev's `POST /api/workspaces/[workspaceId]/orca` and connects it through
  the vendored `rpc-client.ts::connect()`, skipping Orca's own QR-scan flow
  entirely.
- `apps/mobile/src/app/(app)/workspace/[workspaceId]/orca.tsx` — mounts the
  vendored `TerminalWebView` against that connection.
