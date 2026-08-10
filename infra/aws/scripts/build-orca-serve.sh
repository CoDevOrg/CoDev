#!/usr/bin/env bash
set -euo pipefail

# Builds `orca serve` from stablyai/orca's real MIT source into a CoDev-owned
# artifact (orca-serve-linux-arm64.tar.gz), rather than downloading upstream's
# prebuilt orca-linux-arm64.AppImage release asset. Runs the build inside an
# arm64 Linux container via Apple's `container` tool
# (https://github.com/apple/container) so the packaged AppImage can be
# self-extracted natively (see infra/aws/orca-build/Containerfile) regardless
# of the build host's own OS/arch.
#
# Usage: build-orca-serve.sh <output-dir>
# Produces <output-dir>/orca-serve-linux-arm64.tar.gz(.sha256), consumed by
# deploy.sh the same way it already consumes the orchestrator/guestd binaries.

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly build_context="${repo_root}/infra/aws/orca-build"
readonly output_dir="${1:?usage: build-orca-serve.sh <output-dir>}"
readonly image_tag="codev-orca-build:$(date +%s)"

command -v container >/dev/null 2>&1 || {
  echo "Apple's 'container' CLI is required to build orca serve from source (https://github.com/apple/container)." >&2
  exit 1
}

mkdir -p "${output_dir}"

echo "Building orca serve from source (stablyai/orca) in an arm64 container..."
container build --arch arm64 -f "${build_context}/Containerfile" -t "${image_tag}" "${build_context}"

trap 'container image rm "${image_tag}" >/dev/null 2>&1 || true' EXIT

container run --rm --arch arm64 --cwd /build \
  --mount "type=bind,source=${output_dir},target=/out" \
  "${image_tag}" \
  cp dist/orca-serve-linux-arm64.tar.gz dist/orca-serve-linux-arm64.tar.gz.sha256 /out/

echo "orca serve artifact ready at ${output_dir}/orca-serve-linux-arm64.tar.gz"
