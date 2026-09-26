#!/usr/bin/env bash
set -euo pipefail

# Build the immutable, credential-free part of a CoDev Azure host image.
#
# Azure Image Builder runs this script inside its temporary build VM with a
# user-assigned identity that can read the release container. It deliberately
# does not start CoDev services, mount the runtime data disk, create workspace
# users, fetch Key Vault secrets, or write Caddy state. Those are host-specific
# and remain in bootstrap-host.sh.

: "${CODEV_RELEASE_VERSION:?CODEV_RELEASE_VERSION is required}"
: "${CODEV_ARTIFACT_ACCOUNT:?CODEV_ARTIFACT_ACCOUNT is required}"
readonly release_prefix="${CODEV_RELEASE_VERSION}"
readonly host_arch="${CODEV_HOST_ARCH:-x86_64}"
readonly firecracker_version="v1.13.2"
readonly firecracker_ci_prefix="firecracker-ci/20260723-ae5bf5b68fc4-0"
readonly runtime_dir="/var/lib/codev"
readonly base_dir="${runtime_dir}/base"
readonly orca_dir="/opt/orca"
readonly work_dir="${CODEV_IMAGE_WORK_DIR:-/var/tmp/codev-image}"

case "${host_arch}" in
  x86_64)
    readonly artifact_arch="x86_64"
    readonly firecracker_arch="x86_64"
    readonly guest_lib_dir="x86_64-linux-gnu"
    ;;
  aarch64 | arm64)
    readonly artifact_arch="arm64"
    readonly firecracker_arch="aarch64"
    readonly guest_lib_dir="aarch64-linux-gnu"
    ;;
  *)
    echo "Unsupported CoDev host architecture: ${host_arch}" >&2
    exit 1
    ;;
esac
readonly firecracker_ci_base="https://s3.amazonaws.com/spec.ccfc.min/${firecracker_ci_prefix}/${firecracker_arch}"

codev_stage_key() {
  printf '%s\0' "$@" | sha256sum | cut -d' ' -f1
}

codev_fingerprint() {
  { cat "$@" 2>/dev/null || true; } | sha256sum | cut -d' ' -f1
}

codev_stage_record() {
  local name="$1" key="$2"
  install -d -m 0755 "${runtime_dir}/bootstrap-stamps"
  printf '%s\n' "${key}" >"${runtime_dir}/bootstrap-stamps/${name}"
}

# The Image Builder build VM gets the template's user-assigned identity. Keep
# the release container private and authenticate only through that identity;
# no SAS token or GitHub credential is placed in the image template.
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y ca-certificates curl
if ! command -v az >/dev/null 2>&1; then
  curl -sL https://aka.ms/InstallAzureCLIDeb | bash
fi
until az login --identity --allow-no-subscriptions >/dev/null 2>&1; do
  sleep 5
done

artifact_download() {
  local name="$1" destination="$2"
  install -d -m 0755 "$(dirname "${destination}")"
  az storage blob download \
    --account-name "${CODEV_ARTIFACT_ACCOUNT}" \
    --container-name releases \
    --name "${release_prefix}/${name}" \
    --file "${destination}" \
    --auth-mode login --only-show-errors --no-progress >/dev/null
}

readonly host_packages=(
  ca-certificates
  build-essential
  curl
  debian-keyring
  debian-archive-keyring
  apt-transport-https
  gnupg
  e2fsprogs
  git
  gh
  iptables
  jq
  python3
  python3-gi
  gir1.2-atspi-2.0
  at-spi2-core
  xdotool
  xclip
  xvfb
  ripgrep
  squashfs-tools
  sudo
  xz-utils
  xfsprogs
  libgtk-3-0t64
  libnss3
  libnspr4
  libasound2t64
  libatk1.0-0t64
  libatk-bridge2.0-0t64
  libcups2t64
  libdrm2
  libgbm1
  libxkbcommon0
  libxcomposite1
  libxdamage1
  libxfixes3
  libxrandr2
  libxshmfence1
  libxss1
  libxtst6
  libpango-1.0-0
  libpangocairo-1.0-0
  libcairo2
  libglib2.0-0t64
  libdbus-1-3
  fonts-liberation
  xdg-utils
)

apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y ca-certificates curl gnupg
install -d -m 0755 /usr/share/keyrings
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
  | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y "${host_packages[@]}" caddy

readonly node_setup_url="https://deb.nodesource.com/setup_24.x"
readonly pnpm_version="11.5.0"
readonly codex_version="0.148.0"
readonly claude_code_version="2.1.236"
curl -fsSL "${node_setup_url}" | bash -
apt-get install -y nodejs
corepack enable
corepack prepare "pnpm@${pnpm_version}" --activate
npm install -g "@openai/codex@${codex_version}"
npm install -g "@anthropic-ai/claude-code@${claude_code_version}"

# Cursor's installer is not version-pinnable. The image version is therefore
# the audit boundary: rebuild and validate the image when a new Cursor binary
# is desired, rather than silently changing a running host on boot.
export HOME=/root
curl -fsS https://cursor.com/install | bash
cursor_agent_target="$(readlink -f /root/.local/bin/cursor-agent)"
install -d -m 0755 /opt/cursor-agent
cp -a "$(dirname "${cursor_agent_target}")/." /opt/cursor-agent/
chmod -R go+rX /opt/cursor-agent
ln -sf "/opt/cursor-agent/$(basename "${cursor_agent_target}")" /usr/local/bin/cursor-agent
ln -sf "/opt/cursor-agent/$(basename "${cursor_agent_target}")" /usr/local/bin/agent

install -d -m 0755 "${runtime_dir}" "${base_dir}" "${orca_dir}" /srv/codev/workspaces
install -d -m 0755 /usr/local/libexec
cat >/usr/local/libexec/codev-git-askpass <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${CODEV_GITHUB_TOKEN:?missing GitHub credential}" ;;
  *) exit 1 ;;
esac
ASKPASS
chmod 0755 /usr/local/libexec/codev-git-askpass

artifact_download "codev-orchestrator-linux-${artifact_arch}" /usr/local/bin/codev-orchestrator
artifact_download "codev-guestd-linux-${artifact_arch}" /usr/local/bin/codev-guestd
chmod 0755 /usr/local/bin/codev-orchestrator /usr/local/bin/codev-guestd

readonly superset_guest_archive="superset-host-linux-${artifact_arch}.tar.gz"
artifact_download "${superset_guest_archive}" "${work_dir}/${superset_guest_archive}"
artifact_download "${superset_guest_archive}.sha256" \
  "${work_dir}/${superset_guest_archive}.sha256"
(cd "${work_dir}" && sha256sum --check "${superset_guest_archive}.sha256")

artifact_download "orca-serve-linux-${artifact_arch}.tar.gz" \
  "${work_dir}/orca-serve.tar.gz"
artifact_download "orca-serve-linux-${artifact_arch}.tar.gz.sha256" \
  "${work_dir}/orca-serve.tar.gz.sha256"
(
  cd "${work_dir}"
  echo "$(cat orca-serve.tar.gz.sha256)  orca-serve.tar.gz" | sha256sum --check
)
tar -xzf "${work_dir}/orca-serve.tar.gz" -C "${orca_dir}"
chmod -R go+rX "${orca_dir}"

curl -fsSL \
  "https://github.com/firecracker-microvm/firecracker/releases/download/${firecracker_version}/firecracker-${firecracker_version}-${firecracker_arch}.tgz" \
  -o "${work_dir}/firecracker.tgz"
tar -xzf "${work_dir}/firecracker.tgz" -C "${work_dir}"
release_dir="${work_dir}/release-${firecracker_version}-${firecracker_arch}"
(
  cd "${release_dir}"
  sha256sum --check --ignore-missing SHA256SUMS
)
install -m 0755 \
  "${release_dir}/firecracker-${firecracker_version}-${firecracker_arch}" \
  /usr/local/bin/firecracker
install -m 0755 \
  "${release_dir}/jailer-${firecracker_version}-${firecracker_arch}" \
  /usr/local/bin/jailer

readonly guest_kernel="vmlinux-6.1.176"
curl -fsSL "${firecracker_ci_base}/${guest_kernel}" -o "${base_dir}/vmlinux"
chmod 0644 "${base_dir}/vmlinux"

# Build the guest rootfs once in the image. The runtime release supplies the
# exact daemon and CLI versions; the host no longer repeats unsquashfs/mkfs on
# every deallocated-host wake.
curl -fsSL "${firecracker_ci_base}/ubuntu-24.04.squashfs" \
  -o "${work_dir}/ubuntu.squashfs"
unsquashfs -no-progress -d "${work_dir}/rootfs" "${work_dir}/ubuntu.squashfs"
install -d -m 0755 "${work_dir}/rootfs/opt/codev/superset-host"
tar -xzf "${work_dir}/${superset_guest_archive}" \
  -C "${work_dir}/rootfs/opt/codev/superset-host"
install -m 0755 /usr/local/bin/codev-guestd "${work_dir}/rootfs/usr/local/bin/codev-guestd"
install -m 0755 /usr/bin/git "${work_dir}/rootfs/usr/bin/git"
install -m 0755 /usr/bin/rg "${work_dir}/rootfs/usr/bin/rg"
install -m 0755 /usr/bin/node "${work_dir}/rootfs/usr/local/bin/node"
install -d -m 0755 "${work_dir}/rootfs/usr/local/lib/node_modules"
cp -a "$(npm root -g)/@openai" "${work_dir}/rootfs/usr/local/lib/node_modules/"
cp -a "$(npm root -g)/@anthropic-ai" "${work_dir}/rootfs/usr/local/lib/node_modules/"
ln -s ../lib/node_modules/@openai/codex/bin/codex.js \
  "${work_dir}/rootfs/usr/local/bin/codex"
claude_package_dir="$(npm root -g)/@anthropic-ai/claude-code"
claude_bin_rel="$(jq -re '.bin.claude' "${claude_package_dir}/package.json")"
test -x "${claude_package_dir}/${claude_bin_rel}"
ln -s "../lib/node_modules/@anthropic-ai/claude-code/${claude_bin_rel}" \
  "${work_dir}/rootfs/usr/local/bin/claude"
cp -a /usr/lib/git-core "${work_dir}/rootfs/usr/lib/"
cp -a /usr/share/git-core "${work_dir}/rootfs/usr/share/"
mkdir -p "${work_dir}/rootfs/usr/lib/${guest_lib_dir}"
cp -a "/usr/lib/${guest_lib_dir}/." \
  "${work_dir}/rootfs/usr/lib/${guest_lib_dir}/" 2>/dev/null || true
install -d -m 0755 "${work_dir}/rootfs/workspace"
install -d -m 0755 "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants"

cat >"${work_dir}/rootfs/etc/systemd/system/workspace.mount" <<'UNIT'
[Unit]
Description=CoDev workspace disk
Before=codev-guestd.service

[Mount]
What=/dev/vdb
Where=/workspace
Type=ext4
Options=rw,nosuid,nodev

[Install]
WantedBy=multi-user.target
UNIT

# codev-guestd is the only guest process allowed to use the Superset file
# bridge. Keep this separate from service unit text so a shell user cannot
# replay host-service requests over loopback.
install -d -m 0700 "${work_dir}/rootfs/etc/codev"
superset_bridge_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
printf 'CODEV_SUPERSET_BRIDGE_SECRET=%s\n' "${superset_bridge_secret}" \
  >"${work_dir}/rootfs/etc/codev/superset-bridge.env"
chmod 0600 "${work_dir}/rootfs/etc/codev/superset-bridge.env"

cat >"${work_dir}/rootfs/etc/systemd/system/codev-guestd.service" <<'UNIT'
[Unit]
Description=CoDev guest daemon
After=workspace.mount
Requires=workspace.mount

[Service]
Type=simple
ExecStart=/usr/local/bin/codev-guestd
Environment=CODEV_WORKSPACE_ROOT=/workspace
EnvironmentFile=/etc/codev/superset-bridge.env
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/workspace
RestrictAddressFamilies=AF_VSOCK AF_UNIX AF_INET
TasksMax=256
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT

cat >"${work_dir}/rootfs/etc/systemd/system/codev-superset-host.service" <<'UNIT'
[Unit]
Description=CoDev Superset host service
After=workspace.mount
Requires=workspace.mount

[Service]
Type=simple
ExecStart=/usr/local/bin/node /opt/codev/superset-host/host-service.js
Environment=HOME=/var/lib/codev-superset
Environment=CODEV_WORKSPACE_ROOT=/workspace
EnvironmentFile=/etc/codev/superset-bridge.env
Environment=SUPERSET_HOME_DIR=/var/lib/codev-superset
Environment=HOST_DB_PATH=/var/lib/codev-superset/host.db
Environment=HOST_MIGRATIONS_FOLDER=/opt/codev/superset-host/host-migrations
Environment=SUPERSET_CHAT_V3_MIGRATIONS=/opt/codev/superset-host/chat-migrations
Environment=SUPERSET_AGENT_TEMPLATES_DIR=/opt/codev/superset-host/agent-templates
Environment=SUPERSET_PTY_DAEMON_SCRIPT_PATH=/opt/codev/superset-host/pty-daemon.js
Environment=ORGANIZATION_ID=00000000-0000-4000-8000-000000000001
Environment=AUTH_TOKEN=codev-guest-local
Environment=SUPERSET_API_URL=http://127.0.0.1:9
Environment=PORT=4879
Environment=NODE_ENV=production
StateDirectory=codev-superset
StateDirectoryMode=0700
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/workspace /var/lib/codev-superset
TasksMax=256

[Install]
WantedBy=multi-user.target
UNIT

ln -s ../workspace.mount \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/workspace.mount"
ln -s ../codev-guestd.service \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/codev-guestd.service"
ln -s ../codev-superset-host.service \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/codev-superset-host.service"
cat >"${work_dir}/rootfs/etc/resolv.conf" <<'RESOLV'
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:2 attempts:2
RESOLV

truncate -s 3G "${base_dir}/rootfs.ext4"
mkfs.ext4 -q -F -d "${work_dir}/rootfs" -L CODEV_ROOT "${base_dir}/rootfs.ext4"
chmod 0600 "${base_dir}/rootfs.ext4"

# Seed the same successful-stage keys bootstrap-host.sh computes. On the first
# real host boot this makes the image's immutable work count as already done;
# if a later release changes any input, its key differs and the normal
# bootstrap path safely repairs only that stage.
packages_key="$(codev_stage_key apt-v1 "${host_packages[@]}")"
node_key="$(codev_stage_key node-v1 "${node_setup_url}" "${pnpm_version}" \
  "${codex_version}" "${claude_code_version}")"
cursor_key="$(codev_stage_key cursor-v1 "${release_prefix}")"
caddy_key="$(codev_stage_key caddy-v1 "https://dl.cloudsmith.io/public/caddy/stable")"
orca_key="$(codev_stage_key orca-v1 "$(cat "${work_dir}/orca-serve.tar.gz.sha256" 2>/dev/null || true)")"
firecracker_key="$(codev_stage_key firecracker-v1 "${firecracker_version}" "${firecracker_arch}")"
kernel_key="$(codev_stage_key kernel-v1 "${firecracker_ci_base}/${guest_kernel}")"
rootfs_key="$(codev_stage_key rootfs-v2 \
  "${firecracker_ci_base}/ubuntu-24.04.squashfs" \
  "$(codev_fingerprint /usr/local/bin/codev-guestd)" \
  "$(cat "${work_dir}/${superset_guest_archive}.sha256")" \
  "${packages_key}" \
  "${node_key}")"
codev_stage_record packages "${packages_key}"
codev_stage_record node "${node_key}"
codev_stage_record cursor "${cursor_key}"
codev_stage_record caddy "${caddy_key}"
codev_stage_record orca "${orca_key}"
codev_stage_record firecracker "${firecracker_key}"
codev_stage_record kernel "${kernel_key}"
codev_stage_record rootfs "${rootfs_key}"
install -d -m 0755 /etc/codev
printf '%s\n' "${release_prefix}" >/etc/codev/image-release

# Stable service scaffolding is included, but no service is started from the
# image. bootstrap-host.sh still writes host-specific Caddy/orchestrator
# configuration and owns the first-boot health transition.
cat >/etc/systemd/system/codev-orca-xvfb.service <<'UNIT'
[Unit]
Description=CoDev virtual display for Orca IDE sessions
Before=codev-orchestrator.service

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
UNIT

cat >/usr/local/sbin/codev-firecracker-network-isolation <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

add_rule() {
  iptables -C FORWARD "$@" 2>/dev/null || iptables -A FORWARD "$@"
}

nat_rule() {
  iptables -t nat -C POSTROUTING "$@" 2>/dev/null ||
    iptables -t nat -A POSTROUTING "$@"
}

sysctl -w net.ipv4.ip_forward=1
printf 'net.ipv4.ip_forward = 1\n' >/etc/sysctl.d/99-codev-forwarding.conf
nat_rule -s 10.200.0.0/16 -j MASQUERADE
add_rule -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
add_rule -d 169.254.169.254/32 -j DROP
add_rule -p tcp --dport 22 -j DROP
add_rule -p tcp --dport 25 -j DROP
add_rule -p udp --dport 53 -j ACCEPT
add_rule -p tcp --dport 53 -j ACCEPT
add_rule -p tcp -m multiport --dports 80,443 -j ACCEPT
add_rule -j DROP
SCRIPT
chmod 0700 /usr/local/sbin/codev-firecracker-network-isolation

cat >/etc/systemd/system/codev-firecracker-network-isolation.service <<'UNIT'
[Unit]
Description=CoDev Firecracker guest network isolation
After=network-online.target
Wants=network-online.target
Before=codev-orchestrator.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/codev-firecracker-network-isolation
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

rm -rf "${work_dir}" /var/lib/apt/lists/* /var/cache/apt/*
cloud-init clean --logs --seed 2>/dev/null || true
find /var/log -type f -exec truncate -s 0 {} \; 2>/dev/null || true
rm -f /etc/ssh/ssh_host_* /var/lib/dbus/machine-id
truncate -s 0 /etc/machine-id

echo "CoDev host image provisioning complete for ${release_prefix} (${artifact_arch})"
