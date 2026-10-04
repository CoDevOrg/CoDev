#!/usr/bin/env bash
set -euo pipefail

# Prepare the immutable, credential-free base for one direct ARM64 workspace
# VM. The durable workspace disk is attached later by the lifecycle service.
: "${CODEV_RELEASE_VERSION:?CODEV_RELEASE_VERSION is required}"
: "${CODEV_ARTIFACT_ACCOUNT:?CODEV_ARTIFACT_ACCOUNT is required}"
readonly release_prefix="${CODEV_RELEASE_VERSION}"
readonly runtime_dir="/var/lib/codev"
readonly artifact_dir="/var/tmp/codev-arm-workspace"
readonly install_dir="/opt/codev/superset-host"
readonly cosign_version="3.1.3"
readonly cosign_sha256="c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a"
readonly azure_config_dir="$(mktemp -d)"
export AZURE_CONFIG_DIR="${azure_config_dir}"
trap 'rm -rf "${azure_config_dir}"' EXIT

if [[ "$(uname -m)" != aarch64 ]]; then
  echo "Expected an ARM64 Image Builder VM; found $(uname -m)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y \
  ca-certificates curl git gh jq ripgrep sudo psmisc xz-utils python3 \
  python3-gi gir1.2-atspi-2.0 at-spi2-core xdotool xclip

if ! command -v az >/dev/null 2>&1; then
  curl -sL https://aka.ms/InstallAzureCLIDeb | bash
fi
identity_ready=false
for attempt in {1..24}; do
  if az login --identity --allow-no-subscriptions >/dev/null 2>&1; then
    identity_ready=true
    break
  fi
  sleep 5
done
if [[ "${identity_ready}" != true ]]; then
  echo "Builder managed identity authentication did not become ready within two minutes." >&2
  exit 1
fi

curl -fsSL \
  "https://github.com/sigstore/cosign/releases/download/v${cosign_version}/cosign-linux-arm64" \
  -o /tmp/cosign-linux-arm64
printf '%s  %s\n' "${cosign_sha256}" /tmp/cosign-linux-arm64 | sha256sum --check
install -m 0755 /tmp/cosign-linux-arm64 /usr/local/bin/cosign
rm -f /tmp/cosign-linux-arm64

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

for name in \
  superset-host-linux-arm64.tar.gz \
  codev-guestd-linux-arm64 \
  verify-superset-host-artifact.mjs \
  runtime-manifest.json; do
  artifact_download "${name}" "${artifact_dir}/${name}"
  artifact_download "${name}.sha256" "${artifact_dir}/${name}.sha256"
  artifact_download "${name}.sigstore.json" "${artifact_dir}/${name}.sigstore.json"
  (cd "${artifact_dir}" && sha256sum --check "${name}.sha256")
  cosign verify-blob \
    --bundle "${artifact_dir}/${name}.sigstore.json" \
    --certificate-identity https://github.com/CoDevOrg/CoDev/.github/workflows/build-arm-workspace-image-azure.yml@refs/heads/main \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    "${artifact_dir}/${name}"
done
test "$(jq -r .releaseVersion "${artifact_dir}/runtime-manifest.json")" = "${release_prefix}"
test "$(jq -r .architecture "${artifact_dir}/runtime-manifest.json")" = arm64

readonly host_packages=(
  build-essential
  iptables
  pkg-config
  file
  python3-venv
  ca-certificates
  curl
  git
  gh
  jq
  ripgrep
  sudo
  psmisc
  xz-utils
  python3
  python3-gi
  gir1.2-atspi-2.0
  at-spi2-core
  xdotool
  xclip
  e2fsprogs
  systemd
)
apt-get -o DPkg::Lock::Timeout=300 install -y "${host_packages[@]}"

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@11.5.0 --activate
npm install -g --allow-scripts=@anthropic-ai/claude-code \
  @openai/codex@0.148.0 @anthropic-ai/claude-code@2.1.236

install -d -m 0755 "${install_dir}" /usr/local/bin /workspace \
  /usr/local/lib/codev /usr/local/sbin \
  /etc/systemd/system/multi-user.target.wants /etc/codev \
  "${runtime_dir}/codev-superset" "${runtime_dir}/codev-agent-profiles"
install -m 0755 "${artifact_dir}/codev-guestd-linux-arm64" /usr/local/bin/codev-guestd
install -m 0644 "${artifact_dir}/runtime-manifest.json" /usr/share/codev-arm-runtime.json
tar -xzf "${artifact_dir}/superset-host-linux-arm64.tar.gz" -C "${install_dir}"
install -m 0644 "${artifact_dir}/verify-superset-host-artifact.mjs" \
  /usr/local/lib/codev/verify-superset-host-artifact.mjs
chown -R root:root "${install_dir}" /usr/local/bin/codev-guestd
chmod 0755 /usr/local/bin/codev-guestd

if ! getent group codev-shell >/dev/null; then
  groupadd --system --gid 2000 codev-shell
fi
if ! getent passwd codev-shell >/dev/null; then
  useradd --system --uid 2000 --gid codev-shell --home-dir /workspace \
    --shell /bin/bash --no-create-home --comment 'CoDev workspace shell' codev-shell
fi
chown root:codev-shell /workspace
git config --system --replace-all safe.directory '*'
chmod 2775 /workspace
install -d -o root -g root -m 0700 "${runtime_dir}/codev-agent-profiles"

cat >/etc/systemd/system/workspace.mount <<'UNIT'
[Unit]
Description=Durable CoDev workspace disk
Before=codev-local-secrets.service

[Mount]
What=/dev/disk/azure/scsi1/lun0
Where=/workspace
Type=ext4
Options=rw,nosuid,nodev

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/codev-local-secrets.service <<'UNIT'
[Unit]
Description=Create per-VM bridge credentials after the durable disk is attached
After=workspace.mount
Requires=workspace.mount
ConditionPathIsMountPoint=/workspace

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/codev-create-local-secrets
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

cat >/usr/local/sbin/codev-create-local-secrets <<'SCRIPT'
#!/usr/bin/env sh
set -eu
test -s /etc/codev/superset-bridge.env && exit 0
umask 077
{
  for name in CODEV_SUPERSET_BRIDGE_SECRET HOST_SERVICE_SECRET AUTH_TOKEN; do
    printf '%s=%s\n' "$name" "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  done
} >/etc/codev/superset-bridge.env
chmod 0600 /etc/codev/superset-bridge.env
SCRIPT
chmod 0755 /usr/local/sbin/codev-create-local-secrets

install -m 0755 /var/tmp/codev-local-api-guard /usr/local/sbin/codev-local-api-guard
cat >/etc/systemd/system/codev-local-api-guard.service <<'UNIT'
[Unit]
Description=Restrict privileged loopback RPC to trusted VM callers
Before=codev-guestd.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/codev-local-api-guard
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/codev-guestd.service <<'UNIT'
[Unit]
Description=CoDev local workspace bridge
After=workspace.mount codev-local-secrets.service codev-local-api-guard.service
Requires=workspace.mount codev-local-secrets.service codev-local-api-guard.service

[Service]
Type=simple
# The fenced first-boot disk setup establishes permissions. Never recursively
# change a saved disk: it includes private metadata and member-controlled trees.
ExecStart=/usr/local/bin/codev-guestd
Environment=CODEV_WORKSPACE_ROOT=/workspace
Environment=CODEV_GUESTD_LISTEN_ADDR=127.0.0.1:5252
Environment=GIT_CONFIG_COUNT=1
Environment=GIT_CONFIG_KEY_0=safe.directory
Environment=GIT_CONFIG_VALUE_0=*
EnvironmentFile=/etc/codev/superset-bridge.env
UMask=0002
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/workspace /var/lib/codev/codev-agent-profiles
RestrictAddressFamilies=AF_UNIX AF_INET
TasksMax=256
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/codev-superset-host.service <<'UNIT'
[Unit]
Description=CoDev Superset workspace host service
After=workspace.mount codev-local-secrets.service codev-guestd.service
Requires=workspace.mount codev-local-secrets.service

[Service]
Type=simple
ExecStartPre=/bin/chmod 0711 /var/lib/codev/codev-agent-profiles
ExecStart=/bin/sh -c '/bin/chmod 0711 /var/lib/codev/codev-agent-profiles && exec /usr/bin/node /opt/codev/superset-host/host-service.js'
Environment=HOME=/var/lib/codev/codev-superset
Environment=CODEV_WORKSPACE_ROOT=/workspace
Environment=GIT_CONFIG_COUNT=1
Environment=GIT_CONFIG_KEY_0=safe.directory
Environment=GIT_CONFIG_VALUE_0=*
EnvironmentFile=/etc/codev/superset-bridge.env
Environment=SUPERSET_HOME_DIR=/var/lib/codev/codev-superset
Environment=CODEV_AGENT_PROFILE_ROOT=/var/lib/codev/codev-agent-profiles
Environment=HOST_DB_PATH=/var/lib/codev/codev-superset/host.db
Environment=HOST_MIGRATIONS_FOLDER=/opt/codev/superset-host/host-migrations
Environment=SUPERSET_CHAT_V3_MIGRATIONS=/opt/codev/superset-host/chat-migrations
Environment=SUPERSET_AGENT_TEMPLATES_DIR=/opt/codev/superset-host/agent-templates
Environment=SUPERSET_PTY_DAEMON_SCRIPT_PATH=/opt/codev/superset-host/pty-daemon.js
Environment=ORGANIZATION_ID=00000000-0000-4000-8000-000000000001
Environment=SUPERSET_API_URL=http://127.0.0.1:9
Environment=PORT=4879
Environment=NODE_ENV=production
UMask=0002
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectProc=invisible
ProcSubset=pid
ReadWritePaths=/workspace /var/lib/codev/codev-superset /var/lib/codev/codev-agent-profiles
TasksMax=256

[Install]
WantedBy=multi-user.target
UNIT

ln -s ../workspace.mount /etc/systemd/system/multi-user.target.wants/workspace.mount
ln -s ../codev-local-secrets.service /etc/systemd/system/multi-user.target.wants/codev-local-secrets.service
ln -s ../codev-local-api-guard.service /etc/systemd/system/multi-user.target.wants/codev-local-api-guard.service
ln -s ../codev-guestd.service /etc/systemd/system/multi-user.target.wants/codev-guestd.service
ln -s ../codev-superset-host.service /etc/systemd/system/multi-user.target.wants/codev-superset-host.service

systemctl daemon-reload
systemctl start codev-local-api-guard.service
node --version
pnpm --version
codex --version
claude --version
rm -f /usr/local/bin/cosign
echo "Prepared credential-free ARM64 workspace image for release ${release_prefix}."
