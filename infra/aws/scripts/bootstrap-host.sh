#!/usr/bin/env bash
set -euo pipefail

: "${CODEV_ARTIFACT_BUCKET:?CODEV_ARTIFACT_BUCKET is required}"
: "${CODEV_RELEASE_VERSION:?CODEV_RELEASE_VERSION is required}"

readonly release_prefix="s3://${CODEV_ARTIFACT_BUCKET}/releases/${CODEV_RELEASE_VERSION}"
readonly firecracker_version="v1.13.2"
readonly firecracker_ci_prefix="firecracker-ci/20260723-ae5bf5b68fc4-0/aarch64"
readonly firecracker_ci_base="https://s3.amazonaws.com/spec.ccfc.min/${firecracker_ci_prefix}"
readonly runtime_dir="/var/lib/codev"
readonly base_dir="${runtime_dir}/base"
readonly jailer_dir="/srv/jailer"
readonly host_log_group="${CODEV_HOST_LOG_GROUP:-/codev/orchestrator/codev-runtime}"

# Bare-metal instances can initially inherit the AMI build clock. Wait for the
# EC2 time source before making signed AWS requests or validating apt metadata.
timedatectl set-ntp true
systemctl restart chrony
chronyc -a makestep
if ! chronyc waitsync 60 1.0 0.0 2; then
  echo "system clock did not synchronize" >&2
  exit 1
fi
systemctl restart snap.amazon-ssm-agent.amazon-ssm-agent.service

export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y \
  ca-certificates \
  build-essential \
  curl \
  e2fsprogs \
  git \
  iptables \
  jq \
  python3 \
  ripgrep \
  squashfs-tools \
  xz-utils \
  xfsprogs

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@11.5.0 --activate

curl -fsSL \
  https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb \
  -o /tmp/amazon-cloudwatch-agent.deb
dpkg -i /tmp/amazon-cloudwatch-agent.deb

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

aws s3 cp "${release_prefix}/codev-orchestrator-linux-arm64" /usr/local/bin/codev-orchestrator
aws s3 cp "${release_prefix}/codev-guestd-linux-arm64" /usr/local/bin/codev-guestd
chmod 0755 /usr/local/bin/codev-orchestrator /usr/local/bin/codev-guestd
aws s3 cp "${release_prefix}/verify-lifecycle.sh" /opt/codev-verify-lifecycle.sh
chmod 0755 /opt/codev-verify-lifecycle.sh

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

install -d -m 0755 "${work_dir}/theia-source" "${work_dir}/theia-runtime"
aws s3 cp "${release_prefix}/codev-theia-source.tar.gz" "${work_dir}/codev-theia-source.tar.gz"
tar -xzf "${work_dir}/codev-theia-source.tar.gz" -C "${work_dir}/theia-source"
(
  cd "${work_dir}/theia-source"
  pnpm install --frozen-lockfile
  pnpm --filter @codev/theia-extension build
  pnpm --filter @codev/theia-app run clean
  pnpm --filter @codev/theia-app build:production
  pnpm --filter @codev/theia-app deploy --prod --legacy "${work_dir}/theia-runtime"
  cp -a apps/theia-app/lib "${work_dir}/theia-runtime/lib"
)

curl -fsSL \
  "https://github.com/firecracker-microvm/firecracker/releases/download/${firecracker_version}/firecracker-${firecracker_version}-aarch64.tgz" \
  -o "${work_dir}/firecracker.tgz"
tar -xzf "${work_dir}/firecracker.tgz" -C "${work_dir}"
release_dir="${work_dir}/release-${firecracker_version}-aarch64"
(
  cd "${release_dir}"
  sha256sum --check --ignore-missing SHA256SUMS
)
install -m 0755 \
  "${release_dir}/firecracker-${firecracker_version}-aarch64" \
  /usr/local/bin/firecracker
install -m 0755 \
  "${release_dir}/jailer-${firecracker_version}-aarch64" \
  /usr/local/bin/jailer

curl -fsSL "${firecracker_ci_base}/vmlinux-6.1.176" -o "${base_dir}/vmlinux"
curl -fsSL "${firecracker_ci_base}/ubuntu-24.04.squashfs" -o "${work_dir}/ubuntu.squashfs"
unsquashfs -no-progress -d "${work_dir}/rootfs" "${work_dir}/ubuntu.squashfs"

install -m 0755 /usr/local/bin/codev-guestd "${work_dir}/rootfs/usr/local/bin/codev-guestd"
install -m 0755 /usr/bin/git "${work_dir}/rootfs/usr/bin/git"
install -m 0755 /usr/bin/rg "${work_dir}/rootfs/usr/bin/rg"
install -m 0755 /usr/bin/node "${work_dir}/rootfs/usr/local/bin/node"
install -d -m 0755 "${work_dir}/rootfs/opt/codev"
cp -a "${work_dir}/theia-runtime" "${work_dir}/rootfs/opt/codev/theia"
install -d -m 0755 "${work_dir}/rootfs/opt/codev/theia/plugins"
cp -a /usr/lib/git-core "${work_dir}/rootfs/usr/lib/"
cp -a /usr/share/git-core "${work_dir}/rootfs/usr/share/"
mkdir -p "${work_dir}/rootfs/usr/lib/aarch64-linux-gnu"
cp -a /usr/lib/aarch64-linux-gnu/* "${work_dir}/rootfs/usr/lib/aarch64-linux-gnu/" 2>/dev/null || true
install -d -m 0755 "${work_dir}/rootfs/workspace"

cat >"${work_dir}/rootfs/etc/systemd/system/workspace.mount" <<'UNIT'
[Unit]
Description=CoDev workspace disk
Before=codev-theia.service codev-guestd.service

[Mount]
What=/dev/vdb
Where=/workspace
Type=ext4
Options=rw,nosuid,nodev

[Install]
WantedBy=multi-user.target
UNIT

cat >"${work_dir}/rootfs/etc/systemd/system/codev-theia.service" <<'UNIT'
[Unit]
Description=CoDev Eclipse Theia workspace backend
After=workspace.mount
Requires=workspace.mount

[Service]
Type=simple
StateDirectory=codev-theia
Environment=HOME=/var/lib/codev-theia
ExecStartPre=/usr/bin/mkdir -p /var/lib/codev-theia/plugins
ExecStart=/usr/local/bin/node /opt/codev/theia/lib/backend/main.js /workspace --hostname=127.0.0.1 --port=3000 --plugins=local-dir:/var/lib/codev-theia/plugins
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/workspace /var/lib/codev-theia
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
TasksMax=512
MemoryMax=1024M

[Install]
WantedBy=multi-user.target
UNIT

cat >"${work_dir}/rootfs/usr/local/bin/codev-wait-for-theia" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

for ((attempt = 1; attempt <= 100; attempt += 1)); do
  if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
    exec 3>&-
    exit 0
  fi
  sleep 0.1
done

echo "Theia did not accept connections within 10 seconds." >&2
exit 1
SCRIPT
chmod 0755 "${work_dir}/rootfs/usr/local/bin/codev-wait-for-theia"

cat >"${work_dir}/rootfs/etc/systemd/system/codev-guestd.service" <<'UNIT'
[Unit]
Description=CoDev guest daemon
After=workspace.mount codev-theia.service
Requires=workspace.mount
Wants=codev-theia.service

[Service]
Type=simple
ExecStartPre=/usr/local/bin/codev-wait-for-theia
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
ln -s ../codev-theia.service \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/codev-theia.service"
ln -s ../codev-guestd.service \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/codev-guestd.service"

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

add_rule -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
add_rule -d 169.254.169.254/32 -j DROP
add_rule -p tcp --dport 22 -j DROP
add_rule -p tcp --dport 25 -j DROP
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

cat >/etc/systemd/system/codev-orchestrator.service <<'UNIT'
[Unit]
Description=CoDev Firecracker orchestrator
After=network-online.target
Wants=network-online.target
Requires=codev-firecracker-network-isolation.service
After=codev-firecracker-network-isolation.service

[Service]
Type=simple
ExecStart=/usr/local/bin/codev-orchestrator
Environment=PORT=8080
Environment=SANDBOX_BACKEND=firecracker
Environment=CODEV_MAX_SANDBOXES=2
Environment=CODEV_VM_VCPU=2
Environment=CODEV_VM_MEMORY_MIB=2048
Environment=CODEV_VM_DISK_GIB=10
Environment=CODEV_IDLE_TIMEOUT=15m
Environment=CODEV_HOST_IDLE_TIMEOUT=15m
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

systemctl daemon-reload
systemctl enable codev-firecracker-network-isolation.service
systemctl start codev-firecracker-network-isolation.service
systemctl enable codev-orchestrator.service
systemctl enable amazon-cloudwatch-agent.service
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
systemctl restart codev-orchestrator.service
systemctl --no-pager --full status codev-orchestrator.service
