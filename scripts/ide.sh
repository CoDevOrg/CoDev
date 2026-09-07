#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}/packages/ide"
# Resolve the IDE's own pinned package manager without joining the root graph.
exec corepack pnpm "$@"
