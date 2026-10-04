#!/usr/bin/env bash
set -euo pipefail

readonly resource_group="${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to a dedicated codev-arm-workspace-* group}"
readonly subscription_id="${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
readonly uploader_id="${AZURE_ARTIFACT_UPLOADER_OBJECT_ID:-$(az ad signed-in-user show --query id -o tsv)}"
readonly uploader_type="${AZURE_ARTIFACT_UPLOADER_TYPE:-User}"
readonly artifact_account="${CODEV_ARTIFACT_ACCOUNT:-codevarm$(az account show --query id -o tsv | tr -d '-' | cut -c1-16)}"
readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! "${resource_group}" =~ ^codev-arm-workspace-[a-z0-9-]+$ ]]; then
  echo "Use a dedicated resource group whose name starts with codev-arm-workspace-." >&2
  exit 1
fi

az account set --subscription "${subscription_id}"
if [[ "$(az group show --name "${resource_group}" --query 'tags.Runtime' -o tsv)" != arm-workspace ]]; then
  echo "Create ${resource_group} in ${AZURE_LOCATION:-westus2} and tag it Runtime=arm-workspace first." >&2
  exit 1
fi

deployment="$(az deployment group create \
  --resource-group "${resource_group}" \
  --name arm-workspace-artifact-storage \
  --template-file "${repo_root}/infra/azure/arm-workspace-artifacts.bicep" \
  --parameters location="${AZURE_LOCATION:-westus2}" storageName="${artifact_account}" \
  --query properties.outputs -o json)"
readonly storage_id="$(jq -r '.storageAccountId.value' <<<"${deployment}")"

existing_assignment="$(az role assignment list --scope "${storage_id}" --include-inherited \
  --query "[?principalId=='${uploader_id}' && roleDefinitionName=='Storage Blob Data Contributor'].id | [0]" \
  -o tsv)"
if [[ -z "${existing_assignment}" || "${existing_assignment}" == None ]]; then
  az role assignment create \
    --assignee-object-id "${uploader_id}" \
    --assignee-principal-type "${uploader_type}" \
    --role 'Storage Blob Data Contributor' \
    --scope "${storage_id}" --output none
fi

echo "Prepared private ARM workspace artifact storage: ${artifact_account}"
