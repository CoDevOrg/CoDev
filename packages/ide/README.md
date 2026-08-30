# CoDev IDE

The editor and agent runtime behind every CoDev workspace. It ships as two
artifacts built from this one source tree:

- **The browser client** — built by `pnpm orca:web` into `apps/web/public/orca/`
  and served at `/orca/web-index.html`. `apps/web/components/orca-workspace.tsx`
  boots it in an iframe on the workspace page.
- **`orca serve`** — the Electron main process that backs it. Built by
  `infra/aws/scripts/build-orca-serve.sh`; the orchestrator
  (`services/orchestrator/src/backend/orca.rs`) runs one per workspace on the
  Firecracker host.

Because both come from this directory, they cannot drift apart.

## Origin and license

This is a fork of [stablyai/orca](https://github.com/stablyai/orca), taken at
tag `v1.4.176` (commit `02cea8a`) and MIT-licensed — see [`LICENSE`](LICENSE),
which must stay with the code.

It is **no longer vendored**. Before the fork, CoDev's changes lived in a
13k-line `codev-web.patch` that was re-applied over a fresh upstream clone on
every build. That patch is gone; its contents are now ordinary source files
here, edited like any other CoDev code. There is no upstream fetch in the build
and no patch to reconcile.

The trade this accepts: upstream Orca fixes are no longer a version bump. Taking
one means reading their diff and porting it by hand into a tree that has
diverged.

## Working in here

This project installs and builds **on its own**. It declares its own
`pnpm-workspace.yaml` (`packages: []`), lockfile, `patchedDependencies`, and an
Electron native-rebuild `postinstall`, so the root `pnpm-workspace.yaml`
excludes it and the repo's recursive `build`/`lint`/`typecheck`/`test` scripts
skip it. Run its own tooling from this directory:

```bash
pnpm --dir packages/ide install
```

It formats with oxfmt and lints with oxlint (`.oxfmtrc.json`, `.oxlintrc.json`),
not the repo's Prettier — the root `.prettierignore` excludes this directory for
that reason. Don't reformat it with the root formatter.

## Trimmed at fork time

Directories that no build consumes were left behind: `mobile/` (a separate
workspace with its own lockfile), `docs/` (upstream marketing assets),
`examples/`, `Casks/`, and `.github/`. electron-builder already excluded
`docs`/`examples`/`Casks` from the packaged app. Anything needed later can be
recovered from upstream at the pinned tag.

## Naming

The config and CLI identifiers are CoDev's: `codev.yaml`, `~/.codev`,
`codev-plugin.json`, `codev://pair`, and a `codev` command. Every reader still
accepts the Orca name it replaced, so existing config, plugins, and pairing
links keep working — see the table in
[`CODEV-INTEGRATION.md`](CODEV-INTEGRATION.md).

Package and app identity is deliberately unchanged (`productName`, the Electron
`name`, the `com.stablyai.orca` bundle id, deb/rpm package and artifact names):
those are tied to code signing, TCC grants, update channels, and the userData
directory, so renaming them would orphan user data rather than rename a command.

What is left is display copy, not identifiers: `Orca` strings in the built
bundle are still rewritten to `CoDev` after the fact by
`infra/aws/orca-build/brand-web.mjs`, and the non-English locale bundles are
untouched. Folding that into the source is the remaining work.

## How CoDev uses it

[`CODEV-INTEGRATION.md`](CODEV-INTEGRATION.md) documents every CoDev-specific
behavior in this tree: the embedding contract and pairing fragment, the single
folded sidebar, the default chat tab, per-member agent subscriptions, the
parent-page bridge, and the theme and branding layers.
