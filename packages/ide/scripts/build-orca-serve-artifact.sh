#!/usr/bin/env bash
set -euo pipefail

# Builds the `orca serve` artifact the orchestrator runs per workspace, from
# this package's source, on the machine that runs this script.
#
# Both callers share it so the container build and the CI build cannot drift:
#   - infra/aws/orca-build/Containerfile (macOS dev machines, via Apple
#     `container`, possibly cross-architecture)
#   - infra/aws/scripts/build-orca-serve.sh, directly, when it is already
#     running on Linux with the target architecture
#
# TARGET_ARCH is electron-builder's name (arm64|x64); ARTIFACT_ARCH is the
# release-artifact name (arm64|x86_64). Output lands in dist/.

readonly target_arch="${TARGET_ARCH:?TARGET_ARCH is required (arm64|x64)}"
readonly artifact_arch="${ARTIFACT_ARCH:?ARTIFACT_ARCH is required (arm64|x86_64)}"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm install --frozen-lockfile

# ORCA_LINUX_ARM64_RELEASE controls electron-builder's ARM artifact naming.
if [ "${target_arch}" = arm64 ]; then
  export ORCA_LINUX_ARM64_RELEASE=1
fi
# Run electron-builder directly rather than `pnpm run build:linux -- ...`: that
# script does not forward extra args (pnpm passes them through as a literal
# `-- ...` that electron-builder/yargs treats as positional and ignores), so
# `--publish never` and `--<arch>` never took effect. This path only needs the
# built AppImage's bytes to repackage into the orca-serve tarball below, and
# `--publish never` is required because the electron-builder config still
# carries upstream Orca's `publish` block (github / stablyai) which
# electron-builder auto-acts on under CI, then dies on a missing GH_TOKEN.
pnpm run build:desktop
pnpm run ensure:electron-runtime
pnpm exec electron-builder \
  --config config/electron-builder.config.cjs \
  --linux AppImage deb \
  --"${target_arch}" \
  --publish never

# Extract the AppImage's appended SquashFS directly rather than executing its
# static ELF launcher, which cannot run under Apple Container's
# cross-architecture emulation. squashfs-root/ is also exactly the layout
# production runs `AppRun` out of, so the host needs no AppImage handling.
appimage="$(find dist -maxdepth 1 -name '*.AppImage' -print -quit)"
test -n "${appimage}"
squashfs_offset=""
for candidate in $(grep -aob 'hsqs' "${appimage}" | cut -d: -f1); do
  if unsquashfs -s -o "${candidate}" "${appimage}" >/dev/null 2>&1; then
    squashfs_offset="${candidate}"
    break
  fi
done
test -n "${squashfs_offset}"
rm -rf dist/squashfs-root
unsquashfs -no-progress -o "${squashfs_offset}" -d dist/squashfs-root "${appimage}" >/dev/null

archive="dist/orca-serve-linux-${artifact_arch}.tar.gz"
tar -C dist -czf "${archive}" squashfs-root
sha256sum "${archive}" | awk '{print $1}' >"${archive}.sha256"
echo "built ${archive}"
