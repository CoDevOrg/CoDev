#!/usr/bin/env bash
# Infrastructure cleanup for an already-fenced generation. The controller must
# revoke its tunnel first. The durable disk is deliberately never deleted here.
set -euo pipefail
readonly resource_group=${AZURE_RESOURCE_GROUP:?Set an isolated ARM resource group}
readonly instance=${1:?Instance name}
readonly workspace_id=${2:?Workspace ID}
readonly generation=${3:?Generation}
[[ ${resource_group} =~ ^codev-arm-workspace-[a-z0-9-]+$ ]] || exit 1
[[ ${instance} =~ ^[a-z0-9-]{1,40}$ && ${generation} =~ ^[1-9][0-9]*$ ]] || exit 1

assert_owned() {
  local id=$1
  az resource show --ids "${id}" --query tags -o json | \
    python3 -c '
import json, sys
tags = json.load(sys.stdin)
assert tags.get("Runtime") == "arm-workspace"
assert tags.get("WorkspaceId") == sys.argv[1]
assert tags.get("Generation") == sys.argv[2]
' "${workspace_id}" "${generation}"
}

# List first, then validate everything before the first deletion. Missing VMs
# are reconciled by their exact generation-owned resource names, not wildcards.
readonly subscription=$(az account show --query id -o tsv)
readonly prefix="/subscriptions/${subscription}/resourceGroups/${resource_group}/providers"
readonly vm_id="${prefix}/Microsoft.Compute/virtualMachines/${instance}"
readonly resources=$(az resource list --resource-group "${resource_group}" --query '[].{id:id,name:name}' -o json)
readonly ids=$(python3 -c '
import json, sys
names = {sys.argv[1] + suffix for suffix in ["", "-os", "-nic", "-ip", "-vnet", "-nsg"]}
print("\n".join(r["id"] for r in json.load(sys.stdin) if r["name"] in names))
' "${instance}" <<<"${resources}")
while IFS= read -r id; do
  [[ -z ${id} ]] || assert_owned "${id}"
done <<<"${ids}"

if [[ ${ids} == *"${vm_id}"* ]]; then
  # Do not delete profiles here. The lifecycle controller must checkpoint
  # refreshed credentials before it permits Azure to discard the OS disk.
  # Unmounting proves the durable filesystem is no longer live before a new
  # generation is permitted to attach it.
  az vm run-command invoke --ids "${vm_id}" --command-id RunShellScript \
    --scripts '
set -euo pipefail
for unit in codev-arm-tunnel codev-arm-gateway codev-superset-host codev-guestd; do
  systemctl cat --quiet "$unit" >/dev/null 2>&1 && systemctl stop "$unit"
done
sync
umount /workspace
mountpoint -q /workspace && exit 1
' --query 'value[0].message' -o tsv >/dev/null
  az vm deallocate --ids "${vm_id}" --no-wait
  deallocated=false
  for _ in {1..60}; do
    state=$(az vm get-instance-view --ids "${vm_id}" \
      --query "instanceView.statuses[?starts_with(code, 'PowerState/')].code | [0]" -o tsv)
    if [[ ${state} == PowerState/deallocated ]]; then
      deallocated=true
      break
    fi
    sleep 5
  done
  [[ ${deallocated} == true ]] || { echo 'STOP_FAILED' >&2; exit 1; }
  # Azure's explicit Detach data-disk policy preserves the durable disk.
  az vm delete --ids "${vm_id}" --yes
fi

# Resource dependencies require this order. Every remaining resource has been
# ownership-checked, so retries can complete partial teardown safely.
readonly remaining_ids=$(az resource list --resource-group "${resource_group}" --query '[].id' -o tsv)
for suffix in -nic -ip -os -vnet -nsg; do
  while IFS= read -r id; do
    [[ ${id} == *"/${instance}${suffix}" ]] || continue
    [[ $'\n'${remaining_ids}$'\n' == *$'\n'${id}$'\n'* ]] || continue
    assert_owned "${id}"
    az resource delete --ids "${id}"
  done <<<"${ids}"
done
