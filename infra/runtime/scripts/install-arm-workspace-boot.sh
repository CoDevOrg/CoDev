#!/usr/bin/env bash
# Image-build installation only; no workspace credentials enter this script.
set -euo pipefail
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

# The preview socket holds 127.0.0.1:5261 from early boot so no workspace
# process can bind the port the tunnel's preview hostnames reach. The proxy is
# an unprivileged dynamic user that can reach only loopback listeners and
# never sees workspace files or the VM's private identity and tunnel token.
cat >/etc/systemd/system/codev-arm-preview.socket <<'UNIT'
[Unit]
Description=Hold the CoDev workspace preview port
[Socket]
ListenStream=127.0.0.1:5261
FreeBind=yes
NoDelay=true
[Install]
WantedBy=sockets.target
UNIT
cat >/etc/systemd/system/codev-arm-preview.service <<'UNIT'
[Unit]
Description=CoDev workspace preview proxy
Requires=codev-arm-preview.socket
After=codev-arm-preview.socket
# A start rate limit would fail the socket and release the port.
StartLimitIntervalSec=0
[Service]
ExecStart=/usr/bin/node /usr/local/lib/codev/start-arm-workspace-preview.mjs
Restart=always
RestartSec=1
DynamicUser=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectProc=invisible
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressDeny=any
IPAddressAllow=localhost
InaccessiblePaths=/workspace /var/lib/codev /etc/codev
ReadOnlyPaths=-/etc/codev-preview
MemoryMax=256M
UNIT
systemctl enable codev-arm-preview.socket >/dev/null

cat >/etc/systemd/system/codev-arm-boot.service <<'UNIT'
[Unit]
Description=Initialize the fenced ARM workspace locally
After=network-online.target
ConditionPathExists=/etc/codev/arm-boot.json
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/codev-arm-boot
RemainAfterExit=yes
TimeoutStartSec=180
[Install]
WantedBy=multi-user.target
UNIT
systemctl enable codev-arm-boot.service >/dev/null
