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
  printf 'cat >/var/tmp/codev-arm-provision.sh <<\x27CODEV_PROVISION\x27\n'
  head -n 1 "${repo_root}/infra/runtime/scripts/provision-arm-workspace-image.sh"
  printf 'export CODEV_RELEASE_VERSION=%q\n' "${release_version}"
  printf 'export CODEV_ARTIFACT_ACCOUNT=%q\n' "${artifact_account}"
  tail -n +2 "${repo_root}/infra/runtime/scripts/provision-arm-workspace-image.sh"
  printf '\nCODEV_PROVISION\n'
  printf 'if ! bash /var/tmp/codev-arm-provision.sh >/var/tmp/codev-arm-provision.log 2>&1; then tail -n 50 /var/tmp/codev-arm-provision.log; exit 1; fi\n'
  cat "${repo_root}/infra/runtime/scripts/validate-arm-workspace-image.sh"
  printf '\nrm -f /var/tmp/codev-arm-provision.sh\n'
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

# Generalization removes the ephemeral administrator and its SSH key.
az vm run-command invoke -g "${resource_group}" -n "${builder_name}" \
  --command-id RunShellScript --scripts 'sudo waagent -deprovision+user -force' --output none
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

echo "Published isolated ARM workspace candidate image: ${image_version_id}"
echo "Do not promote it through infra/azure/deploy.sh; that deploys the x86 Firecracker host."
