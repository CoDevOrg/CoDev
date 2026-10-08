#!/usr/bin/env bash
# Trusted first-boot setup only. The fenced controller supplies the saved UUID
# or explicitly authorizes formatting a disk it has just created. Never retry
# an existing workspace as "new" when Azure cannot find its durable disk.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
readonly disk=/dev/disk/azure/scsi1/lun0
readonly mode=${CODEV_DISK_MODE:?Use new or existing}
readonly expected_uuid=${CODEV_DISK_EXPECTED_UUID:-}
[[ ${mode} == new || ${mode} == existing ]] || exit 1
[[ ${mode} == new || -n ${expected_uuid} ]] || exit 1

for _ in {1..60}; do
  [[ -b ${disk} ]] && break
  sleep 1
done
[[ -b ${disk} ]] || { echo 'DISK_MISSING' >&2; exit 1; }
[[ $(blockdev --getsize64 "${disk}") == 17179869184 ]] || {
  echo 'DISK_SIZE_MISMATCH' >&2; exit 1;
}
systemctl stop codev-superset-host codev-guestd
if [[ ${mode} == new ]]; then
  # Only this generation may retry its explicitly authorized fresh disk.
  if [[ -n $(wipefs --no-act --noheadings --output TYPE "${disk}") ]]; then
    [[ -n ${expected_uuid} && $(blkid -s TYPE -o value "${disk}") == ext4 &&
       $(blkid -s UUID -o value "${disk}") == "${expected_uuid}" ]] || {
      echo 'DISK_ALREADY_INITIALIZED' >&2; exit 1;
    }
  elif [[ -n ${expected_uuid} ]]; then
    mkfs.ext4 -q -m 1 -U "${expected_uuid}" "${disk}"
  else
    mkfs.ext4 -q -m 1 "${disk}"
  fi
else
  [[ $(blkid -s TYPE -o value "${disk}") == ext4 ]] || exit 1
  [[ $(blkid -s UUID -o value "${disk}") == "${expected_uuid}" ]] || {
    echo 'DISK_IDENTITY_MISMATCH' >&2; exit 1;
  }
fi
systemctl start workspace.mount
mountpoint -q /workspace

# Sticky, root-owned parent prevents the shell from renaming root-owned private
# metadata. Refuse a member-planted symlink or directory before any root writes.
chown root:codev-shell /workspace
chmod 3775 /workspace
readonly metadata=/workspace/.codev-runtime
if [[ -e ${metadata} || -L ${metadata} ]]; then
  [[ -d ${metadata} && ! -L ${metadata} ]] || exit 1
  [[ $(stat -c '%u:%g:%a' "${metadata}") =~ ^0:0:(700|2700)$ ]] || exit 1
else
  [[ ${mode} == new ]] || { echo 'SAVED_METADATA_MISSING' >&2; exit 1; }
  install -d -o root -g root -m 0700 "${metadata}"
fi
if [[ ${mode} == new ]]; then
  install -d -o root -g root -m 0700 "${metadata}/bootstrap"
  touch "${metadata}/bootstrap/new-disk"
  chmod 0600 "${metadata}/bootstrap/new-disk"
fi
chmod 00700 "${metadata}"
install -d -o root -g root -m 0700 "${metadata}/superset"
chmod 00700 "${metadata}/superset"
recover_git_state() {
  # A new disk has no checkout yet; a bare return would pass the failed test's
  # status to set -e and abort every first boot.
  [[ -d /workspace/.git ]] || return 0
  git -C /workspace worktree prune
  local git_dir
  git_dir=$(git -C /workspace rev-parse --path-format=absolute --git-common-dir)
  [[ ${git_dir} == /workspace/.git ]] || {
    echo 'WORKSPACE_GIT_DIR_INVALID' >&2
    exit 1
  }
  while IFS= read -r -d '' lock; do
    fuser -s "${lock}" && continue
    rm -f -- "${lock}"
  done < <(find -P "${git_dir}" -type f -name '*.lock' -print0)
}
recover_git_state
install -d -m 0755 /etc/systemd/system/codev-guestd.service.d
cat >/etc/systemd/system/codev-guestd.service.d/durable-disk.conf <<'UNIT'
[Service]
# Permissions are established once. Recursive changes would expose protected
# metadata, follow member-controlled trees, and slow every cold start.
ExecStartPre=
InaccessiblePaths=/workspace/.codev-runtime
UNIT
cat >'/etc/systemd/system/var-lib-codev-codev\x2dsuperset.mount' <<'UNIT'
[Unit]
Requires=workspace.mount
After=workspace.mount
Before=codev-superset-host.service
[Mount]
What=/workspace/.codev-runtime/superset
Where=/var/lib/codev/codev-superset
Type=none
Options=bind
UNIT
install -d -m 0755 /etc/systemd/system/codev-superset-host.service.d
cat >/etc/systemd/system/codev-superset-host.service.d/durable-disk.conf <<'UNIT'
[Unit]
RequiresMountsFor=/var/lib/codev/codev-superset
[Service]
InaccessiblePaths=/workspace/.codev-runtime
UNIT
systemctl daemon-reload
systemctl start 'var-lib-codev-codev\x2dsuperset.mount'
systemctl start codev-guestd codev-superset-host
if [[ -f /etc/systemd/system/codev-arm-tunnel.service ]]; then
  systemctl start codev-arm-gateway codev-arm-tunnel
fi
blkid -s UUID -o value "${disk}"
