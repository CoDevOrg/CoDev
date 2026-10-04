#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
output_dir="${1:?Usage: build-arm-workspace-runtime.sh <output-directory>}"
release_version="${CODEV_RELEASE_VERSION:?Set CODEV_RELEASE_VERSION to an immutable release label}"
if [[ ! "${release_version}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "CODEV_RELEASE_VERSION must contain only letters, digits, dots, underscores, or hyphens." >&2
  exit 1
fi

if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then
  echo "Build on native Linux ARM64; found $(uname -s)/$(uname -m)." >&2
  exit 1
fi
for command in bun cargo file node sha256sum tar; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Missing required command: ${command}" >&2
    exit 1
  }
done
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  echo "Build with Node.js 24; found $(node --version)." >&2
  exit 1
fi
if [[ "$(bun --version)" != "$(cat "${repo_root}/vendor/superset/.bun-version")" ]]; then
  echo "Use the Bun version pinned in vendor/superset/.bun-version." >&2
  exit 1
fi
if [[ "$(rustc --version | awk '{print $2}')" != 1.97.1 ]]; then
  echo "Build with Rust 1.97.1; found $(rustc --version)." >&2
  exit 1
fi

readonly build_root="$(mktemp -d)"
trap 'rm -rf "${build_root}"' EXIT
mkdir -p "${build_root}/vendor/superset" "${build_root}/infra/runtime/scripts" \
  "${build_root}/services"
tar -C "${repo_root}/vendor/superset" \
  --exclude=node_modules --exclude='*/node_modules' --exclude='**/node_modules' \
  --exclude=.cache --exclude=.source --exclude=dist --exclude=build \
  --exclude=.turbo -cf - . \
  | tar -C "${build_root}/vendor/superset" -xf -
tar -C "${repo_root}/services" --exclude=target -cf - orchestrator \
  | tar -C "${build_root}/services" -xf -
cp "${repo_root}/infra/runtime/scripts/"{build-superset-host.sh,package-superset-native.mjs,verify-superset-host-artifact.mjs} \
  "${build_root}/infra/runtime/scripts/"

mkdir -p "${output_dir}"
CODEV_SUPERSET_ARTIFACT_VERSION="${release_version}" \
  CODEV_SUPERSET_ARTIFACT_NAME=superset-host-linux-arm64 \
  "${build_root}/infra/runtime/scripts/build-superset-host.sh" "${build_root}/output"
cp "${build_root}/output/superset-host-linux-arm64.tar.gz" "${output_dir}/"

readonly crate="${build_root}/services/orchestrator"
(cd "${crate}" && cargo fmt --check --all && cargo test --locked --release --bin guestd \
  && cargo test --locked --release --lib guest_spawn_error::tests \
  && cargo test --locked --release --lib guest_executable_architecture::tests \
  && cargo build --locked --release --bin guestd)
cp "${crate}/target/release/guestd" "${output_dir}/codev-guestd-linux-arm64"
file "${output_dir}/codev-guestd-linux-arm64" | grep -q 'ARM aarch64' || {
  echo "The guest daemon artifact is not an ARM64 Linux executable." >&2
  exit 1
}
cp "${repo_root}/infra/runtime/scripts/verify-superset-host-artifact.mjs" "${output_dir}/"

for artifact in \
  superset-host-linux-arm64.tar.gz \
  codev-guestd-linux-arm64 \
  verify-superset-host-artifact.mjs; do
  (cd "${output_dir}" && sha256sum "${artifact}" >"${artifact}.sha256")
done

node - "${release_version}" "${output_dir}/runtime-manifest.json" "${repo_root}/vendor/superset" <<'NODE'
const fs = require("node:fs");
const [releaseVersion, outputPath, supersetRoot] = process.argv.slice(2);
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      releaseVersion,
      architecture: "arm64",
      platform: "linux",
      nodeMajor: 24,
      rustVersion: "1.97.1",
      bunVersion: fs.readFileSync(`${supersetRoot}/.bun-version`, "utf8").trim(),
      supersetVersion: JSON.parse(
        fs.readFileSync(`${supersetRoot}/packages/host-service/package.json`, "utf8"),
      ).version,
      binaries: ["codev-guestd-linux-arm64"],
    },
    null,
    2,
  )}\n`,
);
NODE
(cd "${output_dir}" && sha256sum runtime-manifest.json >runtime-manifest.json.sha256)
echo "Built ARM64 runtime release ${release_version} in ${output_dir}"
