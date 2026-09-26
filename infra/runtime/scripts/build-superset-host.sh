#!/usr/bin/env bash
set -euo pipefail

# Build a self-contained Node distribution of the vendored Superset host
# service for the same Linux architecture as the Firecracker guest. This is a
# separate build target; vendor/superset is not part of CoDev's pnpm workspace.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
superset_root="${repo_root}/vendor/superset"
output_dir="${1:-${repo_root}/dist/superset-host}"

if [[ "$(uname -s)" != Linux ]]; then
  echo "Build on Linux: native modules must match the Firecracker guest." >&2
  exit 1
fi

for command in bun node tar sha256sum; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Missing required command: ${command}" >&2
    exit 1
  fi
done

required_bun="$(cat "${superset_root}/.bun-version")"
if [[ "$(bun --version)" != "${required_bun}" ]]; then
  echo "Superset requires Bun ${required_bun}; found $(bun --version)." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major != 24 )); then
  echo "Build with Node.js 24 to match the guest's native module ABI; found $(node --version)." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64) artifact_arch=x86_64 ;;
  aarch64) artifact_arch=arm64 ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

host_version="$(node -p "require('${superset_root}/packages/host-service/package.json').version")"
source_version="${CODEV_SUPERSET_ARTIFACT_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}"
if [[ ! "${source_version}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "CODEV_SUPERSET_ARTIFACT_VERSION must contain only letters, digits, dots, underscores, or hyphens." >&2
  exit 1
fi
archive_stem="${CODEV_SUPERSET_ARTIFACT_NAME:-superset-host-${host_version}-${source_version}-linux-${artifact_arch}}"
if [[ ! "${archive_stem}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "CODEV_SUPERSET_ARTIFACT_NAME must be a plain file stem." >&2
  exit 1
fi
archive_name="${archive_stem}.tar.gz"

echo "==> Installing the pinned Superset dependency graph"
# The artifact has no Electron runtime. Skip its download and desktop-only
# postinstall rebuilds, but keep Superset's ordinary package build scripts.
(cd "${superset_root}" && CI=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install --frozen-lockfile)

echo "==> Bundling host service and PTY daemon"
(cd "${superset_root}/packages/host-service" && bun run build:host)
(cd "${superset_root}/packages/pty-daemon" && bun run build:daemon)

staging="$(mktemp -d)"
trap 'rm -rf "${staging}"' EXIT

install -m 0644 "${superset_root}/packages/host-service/dist/host-service.js" "${staging}/host-service.js"
install -m 0644 "${superset_root}/packages/host-service/dist/host-worker.js" "${staging}/host-worker.js"
install -m 0644 "${superset_root}/packages/pty-daemon/dist/pty-daemon.js" "${staging}/pty-daemon.js"
cp -a "${superset_root}/packages/host-service/drizzle" "${staging}/host-migrations"
cp -a "${superset_root}/packages/chat-runtime/src/db/drizzle" "${staging}/chat-migrations"
cp -a "${superset_root}/packages/agent-setup/templates" "${staging}/agent-templates"
install -m 0644 "${superset_root}/LICENSE.md" "${staging}/LICENSE.superset.md"
printf '{"type":"module"}\n' >"${staging}/package.json"
printf '{"supersetVersion":"%s","sourceVersion":"%s","platform":"linux","architecture":"%s","nodeMajor":%s}\n' \
  "${host_version}" "${source_version}" "${artifact_arch}" "${node_major}" \
  >"${staging}/artifact.json"

echo "==> Materializing Linux native modules and their runtime dependencies"
node "${repo_root}/infra/runtime/scripts/package-superset-native.mjs" "${superset_root}" "${staging}"

echo "==> Checking the standalone native runtime"
(
  cd "${staging}"
  node --input-type=module -e '
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    if (typeof require("node-pty").spawn !== "function") throw new Error("node-pty is unavailable");
    if (typeof require("@parcel/watcher").subscribe !== "function") throw new Error("@parcel/watcher is unavailable");
  '
)

echo "==> Starting the standalone service and checking health"
node "${repo_root}/infra/runtime/scripts/verify-superset-host-artifact.mjs" "${staging}"

mkdir -p "${output_dir}"
archive_path="${output_dir}/${archive_name}"
archive_tmp="${archive_path}.tmp.$$"
trap 'rm -rf "${staging}"; rm -f "${archive_tmp}"' EXIT
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "${staging}" -czf "${archive_tmp}" .
mv -f "${archive_tmp}" "${archive_path}"
(cd "${output_dir}" && sha256sum "${archive_name}" >"${archive_name}.sha256")

echo "Superset host artifact: ${archive_path}"
echo "SHA-256: ${archive_path}.sha256"
