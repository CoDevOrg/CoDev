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
apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  e2fsprogs \
  git \
  jq \
  squashfs-tools

install -d -m 0700 "${runtime_dir}/workspaces"
install -d -m 0755 "${base_dir}" /srv/jailer

aws s3 cp "${release_prefix}/codev-orchestrator-linux-arm64" /usr/local/bin/codev-orchestrator
aws s3 cp "${release_prefix}/codev-guestd-linux-arm64" /usr/local/bin/codev-guestd
chmod 0755 /usr/local/bin/codev-orchestrator /usr/local/bin/codev-guestd

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

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
cp -a /usr/lib/git-core "${work_dir}/rootfs/usr/lib/"
cp -a /usr/share/git-core "${work_dir}/rootfs/usr/share/"
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
RestrictAddressFamilies=AF_VSOCK AF_UNIX
TasksMax=256
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT

ln -s ../workspace.mount \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/workspace.mount"
ln -s ../codev-guestd.service \
  "${work_dir}/rootfs/etc/systemd/system/multi-user.target.wants/codev-guestd.service"

truncate -s 2G "${base_dir}/rootfs.ext4"
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

modprobe kvm
test -r /dev/kvm
test -w /dev/kvm

cat >/etc/systemd/system/codev-orchestrator.service <<'UNIT'
[Unit]
Description=CoDev Firecracker orchestrator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/codev-orchestrator
Environment=PORT=8080
Environment=SANDBOX_BACKEND=firecracker
Environment=CODEV_MAX_SANDBOXES=2
Environment=CODEV_VM_VCPU=2
Environment=CODEV_VM_MEMORY_MIB=2048
Environment=CODEV_VM_DISK_GIB=10
Environment=CODEV_IDLE_TIMEOUT=30m
Environment=CODEV_HOST_IDLE_TIMEOUT=15m
Restart=always
RestartSec=2
KillMode=control-group
LimitNOFILE=65536
TasksMax=4096

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable codev-orchestrator.service
systemctl restart codev-orchestrator.service
systemctl --no-pager --full status codev-orchestrator.service
