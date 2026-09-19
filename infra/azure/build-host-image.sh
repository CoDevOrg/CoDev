#!/usr/bin/env bash
set -euo pipefail

# Create and run one versioned Azure Image Builder template. This is separate
# from deploy.sh on purpose: building an image is an explicit, expensive
# promotion step, while a normal runtime release can continue using the stock
# Ubuntu fallback until the image has passed validation.

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly location="${AZURE_LOCATION:-westus2}"
readonly resource_group="${AZURE_RESOURCE_GROUP:-codev-runtime-migration}"
readonly subscription_id="${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
readonly name_prefix="${CODEV_NAME_PREFIX:-codev-runtime}"
readonly artifact_account="${CODEV_ARTIFACT_ACCOUNT:-codevrt$(echo "${subscription_id}" | tr -d '-' | cut -c1-8)}"
readonly release_version="${CODEV_RELEASE_VERSION:?Set CODEV_RELEASE_VERSION to an uploaded runtime release}"
readonly image_version="${CODEV_IMAGE_VERSION:?Set CODEV_IMAGE_VERSION, for example 1.0.12}"
readonly host_arch="${CODEV_HOST_ARCH:-x86_64}"
readonly image_builder_vm_size="${CODEV_IMAGE_BUILDER_VM_SIZE:-Standard_D4s_v7}"
readonly template_name="${name_prefix}-image-${image_version}"

if [[ ! "${image_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "CODEV_IMAGE_VERSION must be semver-like numeric form: 1.0.12" >&2
  exit 1
fi

az account set --subscription "${subscription_id}"

readonly provision_script="${repo_root}/infra/runtime/scripts/provision-host-image.sh"
readonly rendered_provision_script="$(mktemp)"
trap 'rm -f "${rendered_provision_script}"' EXIT

# Azure Image Builder invokes Shell customizers without the caller's shell
# environment. Render the release coordinates into the uploaded script so the
# build VM can download the exact immutable artifacts without exposing a SAS
# token or relying on ambient environment variables.
{
  printf 'export CODEV_RELEASE_VERSION=%q\n' "${release_version}"
  printf 'export CODEV_ARTIFACT_ACCOUNT=%q\n' "${artifact_account}"
  printf 'export CODEV_HOST_ARCH=%q\n' "${host_arch}"
  cat "${provision_script}"
} >"${rendered_provision_script}"
readonly provision_sha256="$(sha256sum "${rendered_provision_script}" | cut -d' ' -f1)"

echo "==> Uploading image provisioner to ${release_version}"
az storage blob upload \
  --account-name "${artifact_account}" \
  --container-name releases \
  --name "${release_version}/provision-host-image.sh" \
  --file "${rendered_provision_script}" \
  --overwrite --auth-mode login --only-show-errors --no-progress >/dev/null

echo "==> Deploying Azure Image Builder template ${template_name}"
deployment_json="$(az deployment group create \
  --resource-group "${resource_group}" \
  --name "codev-host-image-${image_version}" \
  --template-file "${repo_root}/infra/azure/image-builder.bicep" \
  --parameters \
    namePrefix="${name_prefix}" \
    location="${location}" \
    artifactStorageName="${artifact_account}" \
    releaseVersion="${release_version}" \
    imageVersion="${image_version}" \
    hostArchitecture="${host_arch}" \
    imageBuilderVmSize="${image_builder_vm_size}" \
    provisionScriptSha256="${provision_sha256}" \
  --query properties.outputs -o json)"

readonly image_template_id="$(jq -r '.imageTemplateId.value' <<<"${deployment_json}")"
readonly image_definition_id="$(jq -r '.imageDefinitionId.value' <<<"${deployment_json}")"
readonly image_version_id="$(jq -r '.imageVersionId.value' <<<"${deployment_json}")"
if [[ -z "${image_template_id}" || "${image_template_id}" == "null" ]]; then
  echo "Image Builder deployment did not return an image template ID." >&2
  exit 1
fi

echo "==> Starting Image Builder run"
az resource invoke-action \
  --action Run \
  --ids "${image_template_id}" \
  --request-body '{}' \
  --only-show-errors --output none

readonly run_output_id="${image_template_id}/runOutputs/codev-gallery"
for attempt in {1..240}; do
  state="$(az resource show --ids "${run_output_id}" \
    --query properties.provisioningState -o tsv 2>/dev/null || true)"
  case "${state}" in
    Succeeded)
      echo "==> Image Builder published ${image_version_id}"
      cat <<SUMMARY

Validated CoDev host image:

  CODEV_HOST_IMAGE_ID=${image_version_id}

The stable image definition is:

  ${image_definition_id}

Promote the exact version with CODEV_HOST_IMAGE_ID before running
infra/azure/deploy.sh. Keep the previous version ID for rollback.
SUMMARY
      exit 0
      ;;
    Failed | Canceled)
      echo "Image Builder run ended in ${state}. Inspect ${run_output_id}." >&2
      exit 1
      ;;
  esac
  echo "Image Builder state: ${state:-pending} (attempt ${attempt}/240)"
  sleep 30
done

echo "Image Builder did not finish within 120 minutes: ${run_output_id}" >&2
exit 1
