#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly location="${AZURE_LOCATION:-westus2}"
readonly resource_group="${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to a dedicated codev-arm-workspace-* resource group}"
readonly subscription_id="${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
readonly artifact_account="${CODEV_ARTIFACT_ACCOUNT:?Set CODEV_ARTIFACT_ACCOUNT to a dedicated ARM build storage account}"
readonly release_version="${CODEV_RELEASE_VERSION:?Set CODEV_RELEASE_VERSION to the uploaded ARM64 artifact prefix}"
readonly image_version="${CODEV_IMAGE_VERSION:?Set CODEV_IMAGE_VERSION, for example 1.0.0}"
readonly source_image_version="${CODEV_SOURCE_IMAGE_VERSION:-24.04.202609040}"
readonly name_prefix="${CODEV_NAME_PREFIX:-codev-arm-workspace}"

if [[ ! "${resource_group}" =~ ^codev-arm-workspace-[a-z0-9-]+$ ]]; then
  echo "Use a dedicated resource group whose name starts with codev-arm-workspace-." >&2
  exit 1
fi
if [[ ! "${image_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "CODEV_IMAGE_VERSION must be semver-like numeric form: 1.0.0" >&2
  exit 1
fi
if [[ ! "${release_version}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "CODEV_RELEASE_VERSION must contain only letters, digits, dots, underscores, or hyphens." >&2
  exit 1
fi
if [[ ! "${source_image_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "CODEV_SOURCE_IMAGE_VERSION must be a pinned Ubuntu image version." >&2
  exit 1
fi

az account set --subscription "${subscription_id}"
if [[ "$(az group show --name "${resource_group}" --query 'tags.Runtime' -o tsv)" != arm-workspace ]]; then
  echo "Resource group ${resource_group} must be pre-created and tagged Runtime=arm-workspace." >&2
  exit 1
fi

readonly build_dir="$(mktemp -d)"
readonly builder_name="${name_prefix}-build-${image_version//./-}"
cleanup() {
  az vm delete -g "${resource_group}" -n "${builder_name}-warm" --yes --only-show-errors >/dev/null 2>&1 || true
  az vm delete -g "${resource_group}" -n "${builder_name}" --yes --only-show-errors >/dev/null 2>&1 || true
  az network nic delete -g "${resource_group}" -n "${builder_name}-nic" --only-show-errors >/dev/null 2>&1 || true
  az network public-ip delete -g "${resource_group}" -n "${builder_name}-ip" --only-show-errors >/dev/null 2>&1 || true
  az network vnet delete -g "${resource_group}" -n "${builder_name}-vnet" --only-show-errors >/dev/null 2>&1 || true
  az network nsg delete -g "${resource_group}" -n "${builder_name}-nsg" --only-show-errors >/dev/null 2>&1 || true
  rm -rf "${build_dir}"
}
if az sig image-version show -g "${resource_group}" --gallery-name codevarmworkspacegallery \
  --gallery-image-definition codev-workspace-arm64 --gallery-image-version "${image_version}" >/dev/null 2>&1; then
  rm -rf "${build_dir}"
  echo "Image version already exists; choose a new immutable version." >&2
  exit 1
fi
if az vm show -g "${resource_group}" -n "${builder_name}" >/dev/null 2>&1; then
  rm -rf "${build_dir}"
  echo "Candidate builder already exists; inspect it before retrying." >&2
  exit 1
fi
trap cleanup EXIT
ssh-keygen -q -t ed25519 -N '' -f "${build_dir}/builder-key"

deployment_json="$(az deployment group create \
  --resource-group "${resource_group}" \
  --name "arm-workspace-native-image-${image_version}" \
  --template-file "${repo_root}/infra/azure/arm-workspace-image-builder.bicep" \
  --parameters namePrefix="${name_prefix}" location="${location}" \
    artifactStorageName="${artifact_account}" releaseVersion="${release_version}" \
    imageVersion="${image_version}" sourceImageVersion="${source_image_version}" \
    builderSshPublicKey="$(cat "${build_dir}/builder-key.pub")" \
  --query properties.outputs -o json)"
readonly builder_id="$(jq -er '.builderId.value' <<<"${deployment_json}")"
readonly image_version_id="$(jq -er '.imageVersionId.value' <<<"${deployment_json}")"

# Only credential-free source enters Azure Run Command. Provider and GitHub
# credentials never enter builder metadata, logs, user data, or the image.
{
  printf 'set -euo pipefail\n'
  printf 'cat >/var/tmp/codev-local-api-guard <<\x27CODEV_LOCAL_GUARD\x27\n'
  cat "${repo_root}/infra/runtime/scripts/restrict-arm-workspace-local-api.sh"
  printf '\nCODEV_LOCAL_GUARD\n'
  for script in arm-workspace-capability.mjs arm-workspace-gateway.mjs arm-workspace-bootstrap.mjs start-arm-workspace-gateway.mjs arm-workspace-preview-token.mjs arm-workspace-preview-upstream.mjs arm-workspace-preview-upgrade.mjs arm-workspace-preview.mjs start-arm-workspace-preview.mjs install-arm-workspace-boot.sh activate-arm-workspace-boot.sh boot-arm-workspace.sh prepare-arm-workspace-disk.sh; do
    printf 'cat >/var/tmp/%s <<\x27CODEV_BOOT_ARTIFACT\x27\n' "${script}"
    cat "${repo_root}/infra/runtime/scripts/${script}"
    printf '\nCODEV_BOOT_ARTIFACT\n'
  done
  printf 'cat >/var/tmp/codev-arm-provision.sh <<\x27CODEV_PROVISION\x27\n'
  head -n 1 "${repo_root}/infra/runtime/scripts/provision-arm-workspace-image.sh"
  printf 'export CODEV_RELEASE_VERSION=%q\n' "${release_version}"
  printf 'export CODEV_ARTIFACT_ACCOUNT=%q\n' "${artifact_account}"
  tail -n +2 "${repo_root}/infra/runtime/scripts/provision-arm-workspace-image.sh"
  printf '\nCODEV_PROVISION\n'
  printf 'if ! bash /var/tmp/codev-arm-provision.sh >/var/tmp/codev-arm-provision.log 2>&1; then tail -n 50 /var/tmp/codev-arm-provision.log; exit 1; fi\n'
  cat "${repo_root}/infra/runtime/scripts/validate-arm-workspace-image.sh"
  printf '\nrm -f /var/tmp/codev-arm-provision.sh /var/tmp/codev-local-api-guard\n'
} >"${build_dir}/provision.sh"
# Run Command executes /bin/sh; explicitly launch the shell required by scripts.
python3 - "${build_dir}/provision.sh" "${build_dir}/run-command.sh" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
pathlib.Path(sys.argv[2]).write_text("bash <<'CODEV_NATIVE_BUILD'\n" + source + "\nCODEV_NATIVE_BUILD\n")
PY
provision_result="$(az vm run-command invoke -g "${resource_group}" -n "${builder_name}" \
  --command-id RunShellScript --scripts "@${build_dir}/run-command.sh" --query 'value[].message' -o tsv)"
printf '%s\n' "${provision_result}"
if ! grep -q CODEV_ARM_IMAGE_VALIDATED <<<"${provision_result}"; then
  echo "Native image provisioning or validation failed; no image will be published." >&2
  exit 1
fi

# waagent removes its own Run Command state, so deprovision over pinned SSH
# instead of awaiting a response from the agent being removed.
readonly builder_ip="$(az network public-ip show -g "${resource_group}" -n "${builder_name}-ip" --query ipAddress -o tsv)"
readonly operator_ip="$(curl --max-time 15 -fsS https://api.ipify.org)"
readonly host_key="$(awk '$1 == "CODEV_BUILDER_HOST_KEY" {print $2 " " $3}' <<<"${provision_result}")"
if [[ -z "${host_key}" || ! "${operator_ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Missing pinned builder host key or operator IPv4 address." >&2
  exit 1
fi
printf '%s %s\n' "${builder_ip}" "${host_key}" >"${build_dir}/known-hosts"
az network nsg rule update -g "${resource_group}" --nsg-name "${builder_name}-nsg" \
  -n DenyAllInbound --priority 200 --output none
az network nsg rule create -g "${resource_group}" --nsg-name "${builder_name}-nsg" \
  -n TemporaryBuilderSsh --priority 100 --access Allow --direction Inbound --protocol Tcp \
  --source-address-prefixes "${operator_ip}/32" --destination-port-ranges 22 --output none
readonly ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes
  -o ServerAliveInterval=15 -o ServerAliveCountMax=4
  -o "UserKnownHostsFile=${build_dir}/known-hosts" -i "${build_dir}/builder-key"
  "codevbuilder@${builder_ip}")
ssh_ready=false
for attempt in {1..12}; do
  if ssh "${ssh_options[@]}" true; then
    ssh_ready=true
    break
  fi
  sleep 5
done
test "${ssh_ready}" = true
ssh "${ssh_options[@]}" 'sudo waagent -deprovision+user -force'
az network nsg rule delete -g "${resource_group}" --nsg-name "${builder_name}-nsg" \
  -n TemporaryBuilderSsh --output none
az vm deallocate -g "${resource_group}" -n "${builder_name}" --only-show-errors
az vm generalize -g "${resource_group}" -n "${builder_name}" --only-show-errors
az sig image-version create -g "${resource_group}" --gallery-name codevarmworkspacegallery \
  --gallery-image-definition codev-workspace-arm64 --gallery-image-version "${image_version}" \
  --virtual-machine "${builder_id}" --location "${location}" --target-regions "${location}" \
  --replica-count 1 --storage-account-type Standard_LRS --exclude-from-latest true \
  --tags ReleaseVersion="${release_version}" ImageVersion="${image_version}" \
    Architecture=arm64 Runtime=standalone-workspace-vm SourceImageVersion="${source_image_version}" \
    SourceCommit="${GITHUB_SHA:-$(git -C "${repo_root}" rev-parse HEAD)}" \
  --query '{id:id,state:provisioningState,osDiskSize:storageProfile.osDiskImage.sizeInGB}' -o json

# The first VM created from a new gallery version boots several times slower
# (119 s versus ~25 s for 1.0.14). Take that first boot here, in the builder's
# subnet with no public IP, so no member's workspace start pays for it. It also
# proves the published image boots with production's VM shape before promotion.
warm_started=${SECONDS}
az vm create -g "${resource_group}" -n "${builder_name}-warm" --location "${location}" \
  --image "${image_version_id}" --size Standard_D2ps_v6 --security-type Standard \
  --storage-sku StandardSSD_LRS --os-disk-delete-option Delete --nic-delete-option Delete \
  --subnet "$(az network vnet subnet show -g "${resource_group}" --vnet-name "${builder_name}-vnet" -n builder --query id -o tsv)" \
  --public-ip-address "" --nsg "" --admin-username codevwarm \
  --ssh-key-values "${build_dir}/builder-key.pub" --only-show-errors --output none
echo "First boot from ${image_version} reached agent readiness in $((SECONDS - warm_started)) s."
az vm delete -g "${resource_group}" -n "${builder_name}-warm" --yes --only-show-errors

echo "Published isolated ARM workspace candidate image: ${image_version_id}"
echo "Do not promote it through infra/azure/deploy.sh; that deploys the x86 Firecracker host."
