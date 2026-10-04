#!/usr/bin/env bash
set -euo pipefail

test "$(uname -m)" = aarch64
node --version | grep -Eq '^v24\.'
pnpm --version
codex --version
claude --version
test -x /usr/local/bin/codev-guestd
test "$(getent passwd codev-shell | cut -d: -f3)" = 2000
test -L /etc/systemd/system/multi-user.target.wants/workspace.mount
test -L /etc/systemd/system/multi-user.target.wants/codev-guestd.service
test ! -e /etc/codev/superset-bridge.env
test ! -e /root/.azure/accessTokens.json
test ! -e /root/.azure/msal_token_cache.json
test -z "$(find /var/lib/codev/codev-agent-profiles -mindepth 1 -print -quit)"
node /usr/local/lib/codev/verify-superset-host-artifact.mjs /opt/codev/superset-host

readonly workspace="$(mktemp -d)"
CODEV_WORKSPACE_ROOT="${workspace}" CODEV_GUESTD_LISTEN_ADDR=127.0.0.1:5252 \
  /usr/local/bin/codev-guestd >/tmp/codev-guestd-image-smoke.log 2>&1 &
readonly pid=$!
trap 'kill "${pid}" 2>/dev/null || true; rm -rf "${workspace}"' EXIT
healthy=false
for attempt in {1..20}; do
  if curl --max-time 2 -fsS http://127.0.0.1:5252/healthz | jq -e '.status == "ok"'; then
    healthy=true
    break
  fi
  sleep 1
done
test "${healthy}" = true
ss -ltnH sport = :5252 | grep -q '127.0.0.1:5252'
echo 'CODEV_ARM_IMAGE_VALIDATED'
