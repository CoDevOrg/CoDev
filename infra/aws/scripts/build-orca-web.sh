#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly patch_file="${repo_root}/infra/aws/orca-build/codev-web.patch"
readonly preload_file="${repo_root}/infra/aws/orca-build/codev-preload.js"
readonly brand_script="${repo_root}/infra/aws/orca-build/brand-web.mjs"
readonly target_dir="${repo_root}/apps/web/public/orca"
readonly source_dir="$(mktemp -d /tmp/codev-orca-web.XXXXXX)"
readonly -a pnpm_cmd=(corepack pnpm@10.24.0)

cleanup() {
  rm -rf -- "${source_dir}"
}
trap cleanup EXIT

git clone --branch v1.4.176 --depth 1 https://github.com/stablyai/orca.git "${source_dir}"
readonly actual_commit="$(git -C "${source_dir}" rev-parse --short=12 HEAD)"
case "${actual_commit}" in
  02cea8a*) ;;
  *)
    echo "Orca commit mismatch: expected 02cea8a*, got ${actual_commit}" >&2
    exit 1
    ;;
esac

git -C "${source_dir}" apply --check "${patch_file}"
git -C "${source_dir}" apply "${patch_file}"
"${pnpm_cmd[@]}" --dir "${source_dir}" install --frozen-lockfile
"${pnpm_cmd[@]}" --dir "${source_dir}" typecheck:web
"${pnpm_cmd[@]}" --dir "${source_dir}" build:web
cp "${preload_file}" "${source_dir}/out/web/codev-preload.js"
node "${brand_script}" "${source_dir}/out/web"
rsync -a --delete "${source_dir}/out/web/" "${target_dir}/"

echo "CoDev Orca web client ready at ${target_dir}"
