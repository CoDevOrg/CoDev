#!/usr/bin/env bash
set -euo pipefail

# Builds `orca serve` from stablyai/orca's real MIT source into a CoDev-owned
# architecture-specific artifact rather than downloading an upstream
# prebuilt AppImage release asset. Runs the build inside a matching Linux
# container via Apple's `container` tool
# (https://github.com/apple/container) so the packaged AppImage can be
# self-extracted natively (see infra/aws/orca-build/Containerfile) regardless
# of the build host's own OS/arch.
#
# Usage: build-orca-serve.sh <output-dir> [x86_64|aarch64]
# Produces an architecture-specific tar.gz(.sha256), consumed by
# deploy.sh the same way it already consumes the orchestrator/guestd binaries.

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly build_context="${repo_root}/infra/aws/orca-build"
readonly output_dir="${1:?usage: build-orca-serve.sh <output-dir> [x86_64|aarch64]}"
readonly host_arch="${2:-aarch64}"
readonly image_tag="codev-orca-build:$(date +%s)"

case "${host_arch}" in
  x86_64)
    readonly container_arch="amd64"
    readonly electron_arch="x64"
    readonly artifact_arch="x86_64"
    ;;
  aarch64)
    readonly container_arch="arm64"
    readonly electron_arch="arm64"
    readonly artifact_arch="arm64"
    ;;
  *)
    echo "host architecture must be x86_64 or aarch64" >&2
    exit 1
    ;;
esac

command -v container >/dev/null 2>&1 || {
  echo "Apple's 'container' CLI is required to build orca serve from source (https://github.com/apple/container)." >&2
  exit 1
}

mkdir -p "${output_dir}"

echo "Building orca serve from source (stablyai/orca) for ${host_arch}..."
container build \
  --arch "${container_arch}" \
  --build-arg "TARGET_ARCH=${electron_arch}" \
  --build-arg "ARTIFACT_ARCH=${artifact_arch}" \
  -f "${build_context}/Containerfile" \
  -t "${image_tag}" \
  "${build_context}"

trap 'container image rm "${image_tag}" >/dev/null 2>&1 || true' EXIT

container run --rm --arch "${container_arch}" --cwd /build \
  --mount "type=bind,source=${output_dir},target=/out" \
  "${image_tag}" \
  cp "dist/orca-serve-linux-${artifact_arch}.tar.gz" "dist/orca-serve-linux-${artifact_arch}.tar.gz.sha256" /out/

echo "orca serve artifact ready at ${output_dir}/orca-serve-linux-${artifact_arch}.tar.gz"
