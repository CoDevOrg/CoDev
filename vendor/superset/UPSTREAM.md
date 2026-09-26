# Upstream snapshot

This directory is a first-party vendored snapshot of Superset source. It is
not a Git submodule and production code must not depend on a separately
checked-out Superset repository.

- Upstream: <https://github.com/superset-sh/superset>
- Pinned upstream commit: `0c00c829e24d67a170f3003ca791781624c0615b`
- Upstream version at this revision: `1.30.2`
- CoDev import commit: `1f6ff1055a84b2c41677b082dc612d33d6e92e09`

At the import commit, the `vendor/superset` subtree hash was
`d0086cdad9b7c7a202a58e668cb067ccd0393aeb`, identical to the tree at the
pinned upstream commit. This directory now also contains this CoDev metadata
file; subsequent CoDev changes should be committed in the CoDev repository on
top of the snapshot. Do not move the pin to an upstream branch name such as
`main` without recording and reviewing the new full commit SHA.

For a future upstream update, choose a full upstream commit, replace or merge
the snapshot, update this pin and the adoption map in
[`docs/SUPERSET_ADOPTION_MANIFEST.md`](../../docs/SUPERSET_ADOPTION_MANIFEST.md),
and review the resulting CoDev patch set before updating runtime artifacts.
