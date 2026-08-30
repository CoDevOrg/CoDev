#!/usr/bin/env bash
set -euo pipefail

# Builds the browser IDE client that CoDev serves at /orca/web-index.html from
# CoDev's own first-party IDE source in packages/ide.
#
# This used to clone stablyai/orca at a pinned tag and apply codev-web.patch on
# top. The IDE is forked into this monorepo now (see packages/ide/README.md), so
# there is no upstream fetch and no patch to reconcile — the source that builds
# is the source in the tree.
#
# packages/ide installs into its own node_modules: it declares its own
# pnpm-workspace.yaml (`packages: []`), lockfile, and patchedDependencies, and is
# excluded from the root workspace. The install here is therefore separate from
# the repo's own `pnpm install`, and is skipped when it is already present.

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly source_dir="${repo_root}/packages/ide"
readonly preload_file="${repo_root}/infra/aws/orca-build/codev-preload.js"
readonly brand_script="${repo_root}/infra/aws/orca-build/brand-web.mjs"
readonly target_dir="${repo_root}/apps/web/public/orca"
readonly -a pnpm_cmd=(corepack pnpm@10.24.0)

if [[ ! -d "${source_dir}" ]]; then
  echo "Missing ${source_dir} — CoDev's IDE source is expected in the repo." >&2
  exit 1
fi

# `--frozen-lockfile` on a fresh checkout, but never re-resolve an install that
# is already good: this build runs often and the IDE's dependency graph is large.
if [[ ! -d "${source_dir}/node_modules" ]]; then
  "${pnpm_cmd[@]}" --dir "${source_dir}" install --frozen-lockfile
fi

"${pnpm_cmd[@]}" --dir "${source_dir}" typecheck:web
"${pnpm_cmd[@]}" --dir "${source_dir}" build:web

cp "${preload_file}" "${source_dir}/out/web/codev-preload.js"
node "${brand_script}" "${source_dir}/out/web"
rsync -a --delete "${source_dir}/out/web/" "${target_dir}/"

echo "CoDev IDE web client ready at ${target_dir}"
