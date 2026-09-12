#!/usr/bin/env bash
set -euo pipefail

# Which cloud this host runs on. Everything below is written against the four
# shim functions defined further down rather than against a provider's CLI, so
# the Firecracker, jailer, networking and Orca logic -- the overwhelming
# majority of this script -- stays single-sourced across both. Defaults to aws
# so an existing EC2 deploy behaves exactly as it did before the shim existed.
readonly codev_cloud="${CODEV_CLOUD:-aws}"

: "${CODEV_RELEASE_VERSION:?CODEV_RELEASE_VERSION is required}"
case "${codev_cloud}" in
  aws)
    : "${CODEV_ARTIFACT_BUCKET:?CODEV_ARTIFACT_BUCKET is required}"
    readonly release_prefix="s3://${CODEV_ARTIFACT_BUCKET}/releases/${CODEV_RELEASE_VERSION}"
    ;;
  azure)
    : "${CODEV_ARTIFACT_ACCOUNT:?CODEV_ARTIFACT_ACCOUNT is required}"
    readonly release_prefix="${CODEV_RELEASE_VERSION}"
    ;;
  *)
    echo "Unsupported CODEV_CLOUD: ${codev_cloud}" >&2
    exit 1
    ;;
esac
readonly firecracker_version="v1.13.2"
readonly host_arch="${CODEV_HOST_ARCH:-$(uname -m)}"
case "${host_arch}" in
  x86_64)
    readonly artifact_arch="x86_64"
    readonly firecracker_arch="x86_64"
    readonly cloudwatch_arch="amd64"
    readonly guest_lib_dir="x86_64-linux-gnu"
    ;;
  aarch64 | arm64)
    readonly artifact_arch="arm64"
    readonly firecracker_arch="aarch64"
    readonly cloudwatch_arch="arm64"
    readonly guest_lib_dir="aarch64-linux-gnu"
    ;;
  *)
    echo "Unsupported CoDev host architecture: ${host_arch}" >&2
    exit 1
    ;;
esac
readonly firecracker_ci_prefix="firecracker-ci/20260723-ae5bf5b68fc4-0/${firecracker_arch}"
readonly firecracker_ci_base="https://s3.amazonaws.com/spec.ccfc.min/${firecracker_ci_prefix}"
readonly runtime_dir="/var/lib/codev"
readonly base_dir="${runtime_dir}/base"
readonly jailer_dir="/srv/jailer"
readonly host_log_group="${CODEV_HOST_LOG_GROUP:-/codev/orchestrator/codev-runtime}"
readonly orca_dir="/opt/orca"
readonly orca_workspaces_root="/srv/codev/workspaces"

# ---------------------------------------------------------------------------
# Cloud shim
#
# Four operations differ between clouds; everything else in this script does
# not. Keeping them behind functions is what lets one bootstrap serve both
# runtimes instead of two copies drifting apart.
# ---------------------------------------------------------------------------

# Fetch one release artifact to a local path.
codev_fetch() {
  local name="$1" destination="$2"
  case "${codev_cloud}" in
    aws)
      aws s3 cp "${release_prefix}/${name}" "${destination}"
      ;;
    azure)
      az storage blob download \
        --account-name "${CODEV_ARTIFACT_ACCOUNT}" \
        --container-name releases \
        --name "${release_prefix}/${name}" \
        --file "${destination}" \
        --auth-mode login --only-show-errors --no-progress >/dev/null
      ;;
  esac
}

# This host's own public IPv4, used to derive the nip.io hostname Orca
# advertises to browsers. Both clouds answer on 169.254.169.254 but with
# different paths and a different anti-SSRF header.
codev_public_ipv4() {
  case "${codev_cloud}" in
    aws)
      local token
      token="$(curl -fsS -X PUT "http://169.254.169.254/latest/api/token" \
        -H "X-aws-ec2-metadata-token-ttl-seconds: 60")"
      curl -fsS -H "X-aws-ec2-metadata-token: ${token}" \
        "http://169.254.169.254/latest/meta-data/public-ipv4"
      ;;
    azure)
      # Unreachable in practice: the Azure stack always supplies
      # CODEV_PUBLIC_HOST, so the caller never needs an address. Kept as a
      # loud failure rather than a silent empty string, because Azure IMDS
      # reports an empty publicIpAddress for Standard-SKU addresses and
      # returning that produced a Caddyfile asking for a certificate for
      # ".nip.io".
      echo "Azure hosts take their hostname from CODEV_PUBLIC_HOST" >&2
      return 1
      ;;
  esac
}

# Read the orchestrator's direct-route bearer token. SSM Parameter Store on
# AWS, Key Vault on Azure; both authenticate as the host's own instance
# identity, so no secret is baked into an image or a template.
codev_read_direct_secret() {
  case "${codev_cloud}" in
    aws)
      [[ -n "${CODEV_DIRECT_SECRET_PARAMETER:-}" ]] || return 0
      aws ssm get-parameter \
        --name "${CODEV_DIRECT_SECRET_PARAMETER}" \
        --with-decryption \
        --query 'Parameter.Value' \
        --output text 2>/dev/null || true
      ;;
    azure)
      [[ -n "${CODEV_KEY_VAULT_NAME:-}" ]] || return 0
      az keyvault secret show \
        --vault-name "${CODEV_KEY_VAULT_NAME}" \
        --name orchestrator-direct-secret \
        --query value --output tsv 2>/dev/null || true
      ;;
  esac
}

# Caddy certificate persistence, in both directions.
codev_caddy_sync() {
  local direction="$1" local_dir="$2"
  case "${codev_cloud}" in
    aws)
      if [[ "${direction}" == "down" ]]; then
        aws s3 sync "s3://${CODEV_ARTIFACT_BUCKET}/caddy-data/" "${local_dir}/" --only-show-errors
      else
        aws s3 sync "${local_dir}/" "s3://${CODEV_ARTIFACT_BUCKET}/caddy-data/" --sse AES256 --only-show-errors
      fi
      ;;
    azure)
      if [[ "${direction}" == "down" ]]; then
        az storage blob download-batch \
          --account-name "${CODEV_ARTIFACT_ACCOUNT}" --source caddy-data \
          --destination "${local_dir}" --auth-mode login --only-show-errors --no-progress >/dev/null
      else
        az storage blob upload-batch \
          --account-name "${CODEV_ARTIFACT_ACCOUNT}" --destination caddy-data \
          --source "${local_dir}" --overwrite --auth-mode login --only-show-errors --no-progress >/dev/null
      fi
      ;;
  esac
}

# The host authenticates to Azure as its own system-assigned managed identity.
# This is the Azure analogue of the EC2 instance profile: nothing to rotate,
# nothing stored on disk.
if [[ "${codev_cloud}" == "azure" ]]; then
  until az login --identity >/dev/null 2>&1; do sleep 5; done
fi

# How this host powers itself down when the orchestrator's idle timer fires.
#
# This is not cosmetic on Azure. EC2 instances carry
# `InstanceInitiatedShutdownBehavior: stop`, so a guest `systemctl poweroff`
# stops the instance and stops the bill. An Azure VM shut down from inside the
# guest stays *allocated* -- the platform keeps reserving its cores and keeps
# charging for them -- so the same call would produce a host that looks off,
# costs full price, and never appears in any stopped-instance report. Only a
# control-plane deallocate actually releases it, which is why the Azure branch
# calls ARM instead of the init system.
install -d -m 0755 /usr/local/sbin
cat >/usr/local/sbin/codev-host-poweroff <<'POWEROFF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${CODEV_CLOUD:-aws}" == "azure" ]]; then
  resource_id="$(curl -fsS -H "Metadata: true" \
    "http://169.254.169.254/metadata/instance/compute/resourceId?api-version=2021-02-01&format=text")"
  # --no-wait: the deallocate tears down the very machine making the request,
  # so waiting for completion means waiting to be killed.
  exec az vm deallocate --ids "${resource_id}" --no-wait
fi
exec systemctl poweroff
POWEROFF
sed -i "1a export CODEV_CLOUD=${codev_cloud}" /usr/local/sbin/codev-host-poweroff
chmod 0755 /usr/local/sbin/codev-host-poweroff

# Instances can initially inherit the image build clock. Wait for the platform
# time source before making signed cloud requests or validating apt metadata.
timedatectl set-ntp true
systemctl restart chrony
chronyc -a makestep
if ! chronyc waitsync 60 1.0 0.0 2; then
  echo "system clock did not synchronize" >&2
  exit 1
fi
if [[ "${codev_cloud}" == "aws" ]]; then
  systemctl restart snap.amazon-ssm-agent.amazon-ssm-agent.service
fi

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

export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y \
  ca-certificates \
  build-essential \
  curl \
  debian-keyring \
  debian-archive-keyring \
  apt-transport-https \
  gnupg \
  e2fsprogs \
  git \
  gh \
  iptables \
  jq \
  python3 \
  python3-gi \
  gir1.2-atspi-2.0 \
  at-spi2-core \
  xdotool \
  xclip \
  xvfb \
  ripgrep \
  squashfs-tools \
  sudo \
  xz-utils \
  xfsprogs \
  libgtk-3-0t64 \
  libnss3 \
  libnspr4 \
  libasound2t64 \
  libatk1.0-0t64 \
  libatk-bridge2.0-0t64 \
  libcups2t64 \
  libdrm2 \
  libgbm1 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libcairo2 \
  libglib2.0-0t64 \
  libdbus-1-3 \
  fonts-liberation \
  xdg-utils

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@11.5.0 --activate
npm install -g @openai/codex@0.148.0
npm install -g @anthropic-ai/claude-code@2.1.236

# Orca's own agent launcher (the IDE's "Launch agent" quick-open menu) probes
# PATH for each agent's detectCmd at runtime and only lists the ones it
# finds — it already recognizes claude/cursor as full agent types, it just
# needs their CLIs present on the host every orca-ws-<workspaceId> user
# shares. Codex/Claude land on PATH via npm above; Cursor's official
# installer only supports installing into the invoking user's own $HOME
# (no env var to redirect it), so relocate the result into a world-readable
# location every workspace user can execute from, mirroring how ${orca_dir}
# below is made world-readable for the same reason.
#
# UserData scripts run without a login shell, so $HOME is unset here — the
# installer's own symlink step resolves the invoking user's home some other
# way (correctly landing at /root/.local/bin), but its download/extract step
# concatenates "$HOME/.local/share/...", which with $HOME empty put the real
# payload at /.local/share/... (filesystem root) instead, leaving the /root
# symlinks dangling. Export HOME explicitly so both steps agree.
export HOME=/root
curl -fsS https://cursor.com/install | bash
cursor_agent_target="$(readlink -f /root/.local/bin/cursor-agent)"
install -d -m 0755 /opt/cursor-agent
cp -a "$(dirname "${cursor_agent_target}")/." /opt/cursor-agent/
chmod -R go+rX /opt/cursor-agent
ln -sf "/opt/cursor-agent/$(basename "${cursor_agent_target}")" /usr/local/bin/cursor-agent
ln -sf "/opt/cursor-agent/$(basename "${cursor_agent_target}")" /usr/local/bin/agent

# Log shipping. The CloudWatch agent is EC2-only in a way that is not merely
# cosmetic: it resolves its instance identity through EC2 IMDS
# (/latest/meta-data/instance-id), which does not exist on Azure, so it exits
# non-zero and takes the whole bootstrap with it.
if [[ "${codev_cloud}" == "aws" ]]; then
  curl -fsSL \
    "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/${cloudwatch_arch}/latest/amazon-cloudwatch-agent.deb" \
    -o /tmp/amazon-cloudwatch-agent.deb
  dpkg -i /tmp/amazon-cloudwatch-agent.deb
fi

install -d -m 0700 "${runtime_dir}/workspaces"
install -d -m 0755 "${base_dir}" "${jailer_dir}"

# Snapshot restore depends on metadata-only reflink clones for the writable
# Firecracker block devices. The root AMI filesystem is not guaranteed to
# support reflinks, so the launch template attaches a dedicated data volume.
# Discover the non-root EBS disk instead of relying on Nitro's device name.
root_source="$(findmnt -no SOURCE /)"
root_disk="$(lsblk -no PKNAME "${root_source}" | head -n 1)"
if [[ -z "${root_disk}" ]]; then
  root_disk="$(basename "${root_source}")"
fi
jailer_device=""
for _ in {1..60}; do
  jailer_device="$(lsblk -dpno NAME,TYPE | awk -v root="/dev/${root_disk}" '$2 == "disk" && $1 != root { print $1; exit }')"
  [[ -n "${jailer_device}" ]] && break
  sleep 2
  done
if [[ -z "${jailer_device}" ]]; then
  echo "No dedicated jailer data volume was found." >&2
  exit 1
fi

if ! blkid "${jailer_device}" >/dev/null 2>&1; then
  mkfs.xfs -f -m reflink=1 "${jailer_device}"
fi
if [[ "$(blkid -o value -s TYPE "${jailer_device}")" != "xfs" ]]; then
  echo "The jailer data volume must use XFS." >&2
  exit 1
fi
if ! xfs_info "${jailer_device}" 2>/dev/null | grep -q 'reflink=1'; then
  echo "The jailer data volume must have XFS reflinks enabled." >&2
  exit 1
fi
jailer_uuid="$(blkid -o value -s UUID "${jailer_device}")"
if ! grep -q "UUID=${jailer_uuid} ${jailer_dir} " /etc/fstab; then
  echo "UUID=${jailer_uuid} ${jailer_dir} xfs noatime,nofail 0 2" >>/etc/fstab
fi
mountpoint -q "${jailer_dir}" || mount "${jailer_dir}"
if ! xfs_info "${jailer_dir}" 2>/dev/null | grep -q 'reflink=1'; then
  echo "Mounted jailer storage does not support reflinks." >&2
  exit 1
fi

codev_fetch "codev-orchestrator-linux-${artifact_arch}" /usr/local/bin/codev-orchestrator
codev_fetch "codev-guestd-linux-${artifact_arch}" /usr/local/bin/codev-guestd
chmod 0755 /usr/local/bin/codev-orchestrator /usr/local/bin/codev-guestd
codev_fetch "verify-lifecycle.sh" /opt/codev-verify-lifecycle.sh
chmod 0755 /opt/codev-verify-lifecycle.sh

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

# orca serve: the per-workspace Orca IDE backend, built by CoDev from source
# (infra/aws/scripts/build-orca-serve.sh) rather than downloaded as a
# prebuilt third-party AppImage release asset. codev-orchestrator spawns one
# instance of this per workspace (services/orchestrator/src/backend/orca.rs).
readonly orca_archive="orca-serve-linux-${artifact_arch}.tar.gz"
codev_fetch "${orca_archive}" "${work_dir}/${orca_archive}"
codev_fetch "${orca_archive}.sha256" "${work_dir}/${orca_archive}.sha256"
(
  cd "${work_dir}"
  echo "$(cat "${orca_archive}.sha256")  ${orca_archive}" | sha256sum --check
)
rm -rf "${orca_dir}"
install -d -m 0755 "${orca_dir}"
tar -xzf "${work_dir}/${orca_archive}" -C "${orca_dir}"
# `--appimage-extract` (in the build container) creates squashfs-root as
# 0700, since it's normally only ever run by the user who extracted it. Here
# it's `AppRun`-ed by each workspace's own dedicated, unprivileged Linux user
# (see services/orchestrator/src/backend/orca.rs), so every file and
# directory underneath needs to be at least world-readable/traversable.
chmod -R go+rX "${orca_dir}"

# orca serve is a full Electron app: even run headless via `--serve`, it
# still needs a real X display to attach to, or it exits immediately before
# ever printing its `orca_server_ready` line. `xvfb` (installed above) only
# provides the binary; this unit is what actually runs a virtual display at
# :99, which services/orchestrator/src/backend/orca.rs assumes is already up
# (CODEV_ORCA_DISPLAY, default ":99") before spawning any session.
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
systemctl daemon-reload
systemctl enable codev-orca-xvfb.service
systemctl restart codev-orca-xvfb.service

# Caddy fronts the public 443 endpoint that browsers connect to directly for
# Orca's WebSocket protocol; the orchestrator manages its routing table at
# runtime over the local admin API (127.0.0.1:2019), one `handle_path
# /w/<workspaceId>/*` route per active IDE session.
install -d -m 0755 /usr/share/keyrings
# --batch --yes, because this script is not run once. Rolling a release
# restarts the host, which re-runs the whole bootstrap, and on the second
# pass the keyring already exists: gpg then tries to ask whether to
# overwrite it, finds no tty, and exits 2 -- taking the bootstrap with it
# after everything before this point has already succeeded.
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
  | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y caddy

# Orca's browser client connects to a `nip.io` hostname that resolves to
# this instance's own current public IP, so a real domain/DNS record is not
# required. Caddy obtains its own TLS certificate for that hostname.
# Azure hands the host a real DNS name through cloud-init (see
# infra/azure/main.bicep), so there is nothing to derive and no address to
# discover. AWS has no equivalent, so it keeps synthesising a nip.io name
# from its own public address.
if [[ -n "${CODEV_PUBLIC_HOST:-}" ]]; then
  orca_public_host="${CODEV_PUBLIC_HOST}"
else
  public_ipv4="$(codev_public_ipv4)"
  if [[ -z "${public_ipv4}" ]]; then
    echo "could not determine this host's public address" >&2
    exit 1
  fi
  orca_public_host="${public_ipv4//./-}.nip.io"
fi

# Bearer token for the /v1/* bypass around API Gateway's hard 29-second
# timeout. Absent or unreadable is not fatal: the route is simply not served,
# which is the same posture as before the bypass existed. Anything other than
# an alphanumeric token is rejected rather than interpolated -- a quote or
# brace would otherwise escape the header matcher into the Caddyfile.
direct_secret="$(codev_read_direct_secret)"
if [[ ! "${direct_secret}" =~ ^[A-Za-z0-9]+$ ]]; then
  echo "direct secret missing or not alphanumeric; not serving /v1/*" >&2
  direct_secret=""
fi

# This block must stay byte-identical to direct_route() in
# services/orchestrator/src/backend/orca.rs. Caddy's config is wholly replaced
# by the orchestrator over the admin API on the first workspace change, so this
# copy only covers the window before that happens -- but during that window it
# is the only thing serving the route.
direct_route=""
if [[ -n "${direct_secret}" ]]; then
  direct_route="  @codev_direct {
    path /v1/*
    header Authorization \"Bearer ${direct_secret}\"
  }
  handle @codev_direct {
    reverse_proxy 127.0.0.1:8080 {
      transport http {
        dial_timeout 10s
        response_header_timeout 900s
      }
    }
  }
  handle /v1/* {
    respond 401
  }
"
fi

cat >/etc/caddy/Caddyfile <<CADDYFILE
{
  admin 127.0.0.1:2019
}

${orca_public_host} {
${direct_route}  respond 404
}
CADDYFILE
# The Caddyfile now carries a bearer token, so keep it off world-readable.
chown root:caddy /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/Caddyfile
# Caddy's certificate storage lives on the root volume, which CloudFormation
# destroys with the instance on every host-affecting deploy. Without this the
# replacement asks Let's Encrypt for a brand new certificate each time, and
# five issuances for the same name inside 168h exhausts the rate limit -- the
# host then serves no TLS at all, which breaks Orca's browser IDE (it connects
# straight to https://<host>/w/<workspaceId>) as well as the /v1 bypass. The
# Elastic IP keeps the hostname stable, so a restored certificate is still
# valid for the replacement.
readonly caddy_data_dir="/var/lib/caddy/.local/share/caddy"
install -d -m 0700 -o caddy -g caddy "${caddy_data_dir}"
codev_caddy_sync down "${caddy_data_dir}" || \
  echo "no stored Caddy certificates to restore; a new one will be requested" >&2
chown -R caddy:caddy /var/lib/caddy

# Push newly obtained or renewed certificates back. Certificates arrive
# asynchronously after Caddy starts, so a one-shot copy here would miss the
# first issuance; a timer also covers renewals. No --delete: an empty or
# half-populated local directory must never wipe the stored copy.
# The timer runs this outside the bootstrap process, so it re-derives the
# shim rather than inheriting it: certificates arrive asynchronously after
# Caddy starts and renew long after bootstrap has exited.
cat >/usr/local/sbin/codev-caddy-cert-sync <<SYNC
#!/usr/bin/env bash
set -euo pipefail
if [[ "${codev_cloud}" == "azure" ]]; then
  az storage blob upload-batch \
    --account-name "${CODEV_ARTIFACT_ACCOUNT:-}" --destination caddy-data \
    --source "${caddy_data_dir}" --overwrite --auth-mode login \
    --only-show-errors --no-progress >/dev/null
else
  aws s3 sync "${caddy_data_dir}/" "s3://${CODEV_ARTIFACT_BUCKET:-}/caddy-data/" \
    --sse AES256 --only-show-errors
fi
SYNC
chmod 0700 /usr/local/sbin/codev-caddy-cert-sync

cat >/etc/systemd/system/codev-caddy-cert-sync.service <<'UNIT'
[Unit]
Description=Persist Caddy certificate storage to S3
After=caddy.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/codev-caddy-cert-sync
UNIT

cat >/etc/systemd/system/codev-caddy-cert-sync.timer <<'UNIT'
[Unit]
Description=Persist Caddy certificate storage to S3

[Timer]
OnBootSec=3min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
UNIT

systemctl enable caddy.service
systemctl restart caddy.service
systemctl daemon-reload
systemctl enable --now codev-caddy-cert-sync.timer

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

curl -fsSL "${firecracker_ci_base}/vmlinux-6.1.176" -o "${base_dir}/vmlinux"
curl -fsSL "${firecracker_ci_base}/ubuntu-24.04.squashfs" -o "${work_dir}/ubuntu.squashfs"
unsquashfs -no-progress -d "${work_dir}/rootfs" "${work_dir}/ubuntu.squashfs"

install -m 0755 /usr/local/bin/codev-guestd "${work_dir}/rootfs/usr/local/bin/codev-guestd"
install -m 0755 /usr/bin/git "${work_dir}/rootfs/usr/bin/git"
install -m 0755 /usr/bin/rg "${work_dir}/rootfs/usr/bin/rg"
install -m 0755 /usr/bin/node "${work_dir}/rootfs/usr/local/bin/node"
install -d -m 0755 "${work_dir}/rootfs/usr/local/lib/node_modules"
cp -a "$(npm root -g)/@openai" "${work_dir}/rootfs/usr/local/lib/node_modules/"
cp -a "$(npm root -g)/@anthropic-ai" "${work_dir}/rootfs/usr/local/lib/node_modules/"
ln -s ../lib/node_modules/@openai/codex/bin/codex.js "${work_dir}/rootfs/usr/local/bin/codex"
# claude-code ships a compiled launcher (2.1.236: bin/claude.exe), not the
# cli.js this used to point at, and the path has already moved once between
# releases. Read it from the package's own bin map and verify it before
# linking: a hardcoded target that goes stale produces a dangling symlink,
# and the only symptom is `claude` failing to spawn inside a guest with "No
# viable candidates found in PATH" long after the host has bootstrapped.
claude_package_dir="$(npm root -g)/@anthropic-ai/claude-code"
claude_bin_rel="$(jq -re '.bin.claude' "${claude_package_dir}/package.json")"
test -x "${claude_package_dir}/${claude_bin_rel}"
ln -s "../lib/node_modules/@anthropic-ai/claude-code/${claude_bin_rel}" \
  "${work_dir}/rootfs/usr/local/bin/claude"
cp -a /usr/lib/git-core "${work_dir}/rootfs/usr/lib/"
cp -a /usr/share/git-core "${work_dir}/rootfs/usr/share/"
mkdir -p "${work_dir}/rootfs/usr/lib/${guest_lib_dir}"
cp -a "/usr/lib/${guest_lib_dir}/." "${work_dir}/rootfs/usr/lib/${guest_lib_dir}/" 2>/dev/null || true
install -d -m 0755 "${work_dir}/rootfs/workspace"

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

cat >"${work_dir}/rootfs/etc/systemd/system/codev-guestd.service" <<'UNIT'
[Unit]
Description=CoDev guest daemon
After=workspace.mount
Requires=workspace.mount

[Service]
Type=simple
ExecStart=/usr/local/bin/codev-guestd
Environment=CODEV_WORKSPACE_ROOT=/workspace
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

ln -s ../workspace.mount \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/workspace.mount"
ln -s ../codev-guestd.service \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/codev-guestd.service"

# The guest's NIC is configured by the kernel `ip=` argument the orchestrator
# passes, which carries an address and route but no resolver. Public servers
# rather than the VPC's: 169.254.169.253 is link-local, so it is unreachable
# from behind the host's NAT, and 169.254.169.254 is deliberately dropped.
cat >"${work_dir}/rootfs/etc/resolv.conf" <<'RESOLV'
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:2 attempts:2
RESOLV

truncate -s 3G "${base_dir}/rootfs.ext4"
mkfs.ext4 -q -F -d "${work_dir}/rootfs" -L CODEV_ROOT "${base_dir}/rootfs.ext4"
chmod 0600 "${base_dir}/rootfs.ext4"
chmod 0644 "${base_dir}/vmlinux"

swapoff --all
sed -i.bak '/\sswap\s/s/^/#/' /etc/fstab
cat >/etc/sysctl.d/99-codev-firecracker.conf <<'SYSCTL'
vm.swappiness=0
kernel.kptr_restrict=2
kernel.dmesg_restrict=1
fs.protected_hardlinks=1
fs.protected_symlinks=1
SYSCTL
sysctl --system

# Every microVM packet traverses the host FORWARD chain. Do not rely only on
# IMDSv2's hop limit: an escaped or misconfigured guest must never obtain the
# host instance profile credentials. The remaining rules limit guest egress to
# package/repository HTTPS and HTTP traffic and prevent SSH/SMTP abuse.
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

# Guests sit on per-slot /30s behind codev-tapN (see backend/firecracker.rs)
# and reach the internet only by being NAT'd here, so forwarding and
# masquerading have to be on for any of the filtering below to see traffic at
# all. Until outbound access was needed for OAuth device flows like
# `claude setup-token`, guests had no NIC and every rule here matched nothing.
sysctl -w net.ipv4.ip_forward=1
printf 'net.ipv4.ip_forward = 1\n' >/etc/sysctl.d/99-codev-forwarding.conf
nat_rule -s 10.200.0.0/16 -j MASQUERADE

add_rule -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
add_rule -d 169.254.169.254/32 -j DROP
add_rule -p tcp --dport 22 -j DROP
add_rule -p tcp --dport 25 -j DROP
# Name resolution, without which the allowed HTTPS below is unreachable by
# hostname. TCP 53 covers responses too large for a UDP datagram.
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

modprobe kvm
test -r /dev/kvm
test -w /dev/kvm

cat >/etc/systemd/system/codev-orchestrator.service <<UNIT
[Unit]
Description=CoDev Firecracker orchestrator
After=network-online.target
Wants=network-online.target
Requires=codev-firecracker-network-isolation.service
After=codev-firecracker-network-isolation.service
Requires=codev-orca-xvfb.service
After=codev-orca-xvfb.service

[Service]
Type=simple
ExecStart=/usr/local/bin/codev-orchestrator
Environment=PORT=8080
Environment=SANDBOX_BACKEND=firecracker
Environment=CODEV_MAX_SANDBOXES=2
Environment=CODEV_VM_VCPU=2
Environment=CODEV_VM_MEMORY_MIB=2048
Environment=CODEV_VM_DISK_GIB=10
Environment=CODEV_IDLE_TIMEOUT=10m
Environment=CODEV_HOST_IDLE_TIMEOUT=10m
Environment=CODEV_ORCA_APPRUN_BIN=${orca_dir}/squashfs-root/AppRun
Environment=CODEV_ORCA_WORKSPACES_ROOT=${orca_workspaces_root}
Environment=CODEV_ORCA_PUBLIC_HOST=${orca_public_host}
Environment=CODEV_ORCA_CADDY_ADMIN_ADDR=127.0.0.1:2019
Environment=CODEV_DIRECT_SECRET=${direct_secret}
Environment=CODEV_MAX_IDE_SESSIONS=4
Environment=CODEV_IDE_IDLE_TIMEOUT=10m
Restart=always
RestartSec=2
KillMode=control-group
LimitNOFILE=65536
TasksMax=4096
StandardOutput=append:/var/log/codev-orchestrator.log
StandardError=append:/var/log/codev-orchestrator.log

[Install]
WantedBy=multi-user.target
UNIT

if [[ "${codev_cloud}" == "aws" ]]; then
cat >/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<AGENT
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/codev-orchestrator.log",
            "log_group_name": "${host_log_group}",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 14
          }
        ]
      }
    }
  }
}
AGENT
fi

systemctl daemon-reload
systemctl enable codev-firecracker-network-isolation.service
systemctl start codev-firecracker-network-isolation.service
systemctl enable codev-orchestrator.service
if [[ "${codev_cloud}" == "aws" ]]; then
  systemctl enable amazon-cloudwatch-agent.service
  # -m ec2 is literal: this mode reads the instance id from EC2 IMDS.
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
fi
systemctl restart codev-orchestrator.service
systemctl --no-pager --full status codev-orchestrator.service
