#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" for the codev project.
#
#   exit 1 (or any non-zero) -> run the build
#   exit 0                    -> skip the build, no deployment is created
#
# Every branch push and every push to main currently starts a full Next.js
# build, and build minutes are the dominant line item on our Vercel bill.
# This keeps every build that could change the deployed site -- so pushing a
# branch and testing its preview still works exactly as before -- and skips
# builds for commits that only touch the Rust orchestrator, infra, the IDE
# fork source, docs, or CI config.
#
# The deployed IDE bundle is the checked-in build output under
# apps/web/public/orca/**, so a packages/ide source change that does not also
# regenerate that bundle (via `pnpm orca:web`) genuinely does not change the
# site and is correctly skipped here.

set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

# Paths whose contents end up in, or change, the built web app.
WATCH=(
  apps/web
  packages/config
  packages/contracts
  packages/db
  packages/shared-types
  pnpm-lock.yaml
  package.json
  pnpm-workspace.yaml
  vercel.json
)

# Prefer diffing against the last commit Vercel actually deployed for this
# branch; fall back to the previous commit for the first build on a branch.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "${base}" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  if git rev-parse -q --verify HEAD^ >/dev/null; then
    base="HEAD^"
  else
    echo "build: no base commit to compare against"
    exit 1
  fi
fi

if git diff --quiet "${base}" HEAD -- "${WATCH[@]}"; then
  echo "skip: no web-relevant changes since ${base}"
  exit 0
fi

echo "build: web-relevant changes since ${base}"
exit 1
