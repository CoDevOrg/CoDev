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
readonly template_name="${name_prefix}-image-${image_version}"

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

readonly provision_script="${repo_root}/infra/runtime/scripts/provision-arm-workspace-image.sh"
readonly rendered_provision_script="$(mktemp)"
trap 'rm -f "${rendered_provision_script}"' EXIT
{
  head -n 1 "${provision_script}"
  printf 'export CODEV_RELEASE_VERSION=%q\n' "${release_version}"
  printf 'export CODEV_ARTIFACT_ACCOUNT=%q\n' "${artifact_account}"
  tail -n +2 "${provision_script}"
} >"${rendered_provision_script}"
readonly provision_sha256="$(sha256sum "${rendered_provision_script}" | cut -d' ' -f1)"

az storage blob upload \
  --account-name "${artifact_account}" \
  --container-name releases \
  --name "${release_version}/provision-arm-workspace-image.sh" \
  --file "${rendered_provision_script}" \
  --overwrite --auth-mode login --only-show-errors --no-progress >/dev/null
readonly script_expiry="$(python3 -c 'from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) + timedelta(hours=6)).strftime("%Y-%m-%dT%H:%MZ"))')"
readonly script_uri="$(az storage blob generate-sas \
  --account-name "${artifact_account}" \
  --container-name releases \
  --name "${release_version}/provision-arm-workspace-image.sh" \
  --permissions r \
  --expiry "${script_expiry}" \
  --auth-mode login --as-user --https-only --full-uri -o tsv)"

CODEV_PROVISION_SCRIPT_URI="${script_uri}" python3 - "${provision_sha256}" <<'PY'
import hashlib, os, sys, urllib.request
with urllib.request.urlopen(os.environ['CODEV_PROVISION_SCRIPT_URI'], timeout=30) as response:
    if hashlib.sha256(response.read()).hexdigest() != sys.argv[1]:
        raise SystemExit('Provision script checksum mismatch')
print('Verified access to the private provision script and its checksum.')
PY

deployment_json="$(az deployment group create \
  --resource-group "${resource_group}" \
  --name "arm-workspace-image-${image_version}" \
  --template-file "${repo_root}/infra/azure/arm-workspace-image-builder.bicep" \
  --parameters \
    namePrefix="${name_prefix}" \
    location="${location}" \
    artifactStorageName="${artifact_account}" \
    releaseVersion="${release_version}" \
    imageVersion="${image_version}" \
    sourceImageVersion="${source_image_version}" \
    provisionScriptSha256="${provision_sha256}" \
    provisionScriptUri="${script_uri}" \
  --query properties.outputs -o json)"

readonly image_template_id="$(jq -r '.imageTemplateId.value' <<<"${deployment_json}")"
readonly image_version_id="$(jq -r '.imageVersionId.value' <<<"${deployment_json}")"
if [[ -z "${image_template_id}" || "${image_template_id}" == null ]]; then
  echo "Image Builder deployment did not return an image template ID." >&2
  exit 1
fi

az resource invoke-action --action Run --ids "${image_template_id}" \
  --request-body '{}' --only-show-errors --output none
readonly run_output_id="${image_template_id}/runOutputs/arm-workspace-gallery"
for attempt in {1..240}; do
  state="$(az resource show --ids "${run_output_id}" \
    --query properties.provisioningState -o tsv 2>/dev/null || true)"
  case "${state}" in
    Succeeded)
      echo "Published isolated ARM workspace candidate image: ${image_version_id}"
      echo "Do not promote it through infra/azure/deploy.sh; that deploys the x86 Firecracker host."
      exit 0
      ;;
    Failed | Canceled)
      echo "Image Builder run ended in ${state}: ${run_output_id}" >&2
      exit 1
      ;;
  esac
  echo "ARM workspace image state: ${state:-pending} (attempt ${attempt}/240)"
  sleep 30
done
echo "Image Builder did not finish within 120 minutes: ${run_output_id}" >&2
exit 1
