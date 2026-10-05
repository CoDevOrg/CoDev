#!/usr/bin/env bash
# Receive VM identity plus its tunnel token on stdin through Azure protected
# extension settings. No member/provider credentials are accepted here.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || exit 1
umask 077
python3 -c '
import json, os, sys
data = json.load(sys.stdin)
token = data.pop("tunnelToken")
assert isinstance(token, str) and token and "\n" not in token
assert set(data) == {"workspaceId", "generation", "audience", "diskUuid", "verificationKey"}
os.makedirs("/etc/codev", mode=0o700, exist_ok=True)
for path, value in [("arm-runtime.json", json.dumps(data)), ("tunnel-token", token)]:
    fd = os.open("/etc/codev/" + path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(value)
    os.chmod("/etc/codev/" + path, 0o600)
'

readonly package=/var/tmp/codev-cloudflared-arm64.deb
readonly install_log=/var/tmp/codev-cloudflared-dpkg.log
curl --fail --silent --show-error --location --max-time 120 \
  https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-linux-arm64.deb \
  --output "${package}"
echo "bcce0111878f13d26e66b1d2ea7f270c8bde4bd549e32ce74d32474521583ca3  ${package}" | sha256sum --check --status
install_deadline=$((SECONDS + 300))
until dpkg -i "${package}" >"${install_log}" 2>&1; do
  if ! grep -q "lock was locked by another process" "${install_log}" ||
    ((SECONDS >= install_deadline)); then
    cat "${install_log}" >&2
    exit 1
  fi
  sleep 5
done
rm -f "${install_log}" "${package}"

cat >/etc/systemd/system/codev-arm-gateway.service <<'UNIT'
[Unit]
Requires=workspace.mount codev-local-api-guard.service codev-superset-host.service
After=workspace.mount codev-local-api-guard.service codev-superset-host.service
[Service]
ExecStart=/usr/bin/node /usr/local/lib/codev/start-arm-workspace-gateway.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/workspace
InaccessiblePaths=/etc/codev/tunnel-token /workspace/.codev-runtime/superset /var/lib/codev/codev-agent-profiles
RestrictAddressFamilies=AF_UNIX AF_INET
MemoryMax=256M
[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/systemd/system/codev-arm-tunnel.service <<'UNIT'
[Unit]
Requires=codev-arm-gateway.service
After=codev-arm-gateway.service network-online.target
[Service]
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run --token-file /etc/codev/tunnel-token
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
InaccessiblePaths=/workspace /var/lib/codev /etc/codev/arm-runtime.json
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=256M
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now codev-arm-gateway codev-arm-tunnel >/dev/null
