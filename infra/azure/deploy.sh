#!/usr/bin/env bash
# Roll out the CoDev runtime on Azure.
#
# The Azure counterpart of infra/aws/deploy.sh, and deliberately the same
# shape: build the orchestrator and guestd, build orca serve, upload both to
# the artifact store, then apply the stack. The differences are the ones the
# platform forces -- Bicep instead of CloudFormation, a blob container instead
# of a bucket, Key Vault instead of SSM -- and the one it does not: there is
# no API Gateway or Lambda proxy to deploy, because apps/web reaches the
# orchestrator through Caddy on the host directly. See infra/azure/main.bicep.
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly location="${AZURE_LOCATION:-westus2}"
readonly resource_group="${AZURE_RESOURCE_GROUP:-codev-runtime-migration}"
readonly subscription_id="${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"

# Nested virtualization is not optional: Firecracker needs /dev/kvm, and a
# size without it produces a host that provisions cleanly and then cannot
# start a single microVM. Verified working on Standard_D2s_v7.
# Must match main.bicep's namePrefix parameter: every resource name below is
# derived from it, so a mismatch silently targets a host that does not exist.
readonly name_prefix="${CODEV_NAME_PREFIX:-codev-runtime}"
readonly vm_size="${CODEV_AZURE_VM_SIZE:-Standard_D2s_v7}"
readonly host_arch="${CODEV_HOST_ARCH:-x86_64}"
readonly host_volume_size_gib="${CODEV_HOST_VOLUME_SIZE_GIB:-64}"
readonly jailer_volume_size_gib="${CODEV_JAILER_VOLUME_SIZE_GIB:-128}"
readonly release_version="${CODEV_RELEASE_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}"
readonly budget_alert_email="${CODEV_BUDGET_ALERT_EMAIL:-}"
readonly enable_budget="${CODEV_ENABLE_BUDGET:-false}"
readonly skip_orca_build="${CODEV_SKIP_ORCA_BUILD:-}"
readonly ssh_public_key="${CODEV_HOST_SSH_PUBLIC_KEY:-$(cat "${HOME}/.ssh/id_rsa.pub" 2>/dev/null || true)}"

if [[ -z "${ssh_public_key}" ]]; then
  echo "Set CODEV_HOST_SSH_PUBLIC_KEY (or provide ~/.ssh/id_rsa.pub)." >&2
  exit 1
fi

# Storage account names are globally unique, lowercase, and capped at 24
# characters, so they cannot simply embed the resource group the way the S3
# bucket embeds the account id. Derive a stable name from the subscription.
readonly artifact_account="${CODEV_ARTIFACT_ACCOUNT:-codevrt$(echo "${subscription_id}" | tr -d '-' | cut -c1-8)}"

az account set --subscription "${subscription_id}"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

readonly build_dir="$(mktemp -d)"
trap 'rm -rf "${build_dir}"' EXIT

case "${host_arch}" in
  x86_64) readonly rust_target="x86_64-unknown-linux-musl"; readonly artifact_arch="x86_64" ;;
  aarch64) readonly rust_target="aarch64-unknown-linux-musl"; readonly artifact_arch="arm64" ;;
  *) echo "Unsupported CODEV_HOST_ARCH: ${host_arch}" >&2; exit 1 ;;
esac

echo "==> Building the orchestrator and guestd for ${rust_target}"
(
  cd "${repo_root}/services/orchestrator"
  cargo zigbuild --release --target "${rust_target}" --bin orchestrator --bin guestd
)
install -m 0755 \
  "${repo_root}/services/orchestrator/target/${rust_target}/release/orchestrator" \
  "${build_dir}/codev-orchestrator-linux-${artifact_arch}"
install -m 0755 \
  "${repo_root}/services/orchestrator/target/${rust_target}/release/guestd" \
  "${build_dir}/codev-guestd-linux-${artifact_arch}"

# Building orca serve from source takes ~15-30 minutes; skip it for
# orchestrator-only iteration once a matching archive already exists at the
# target release version.
if [[ -z "${skip_orca_build}" ]]; then
  echo "==> Building orca serve"
  "${repo_root}/infra/aws/scripts/build-orca-serve.sh" "${build_dir}" "${host_arch}"
fi

# ---------------------------------------------------------------------------
# Stack
# ---------------------------------------------------------------------------

# The bypass bearer token. Created once and never rotated automatically:
# Vercel's ORCHESTRATOR_DIRECT_SECRET has to match, and silently rolling it
# here would break every long-running call until someone noticed. Hex keeps it
# alphanumeric, which the Caddyfile emitters require.
existing_secret="$(az keyvault secret show \
  --vault-name "${name_prefix}-kv" --name orchestrator-direct-secret \
  --query value -o tsv 2>/dev/null || true)"
if [[ -n "${existing_secret}" ]]; then
  direct_secret="${existing_secret}"
else
  direct_secret="$(openssl rand -hex 32)"
fi
readonly direct_secret

# Whether the host already exists decides if it needs restarting later. A VM
# the stack is about to create boots with the right tag on its own; one that
# is already running read its tag at its last boot and has to be rolled.
host_existed=false
if az vm show --resource-group "${resource_group}" --name "${name_prefix}-host" \
  --query id -o tsv >/dev/null 2>&1; then
  host_existed=true
fi
readonly host_existed

echo "==> Applying infra/azure/main.bicep to ${resource_group}"
az deployment group create \
  --resource-group "${resource_group}" \
  --name "codev-runtime-${release_version}" \
  --template-file "${repo_root}/infra/azure/main.bicep" \
  --parameters \
    namePrefix="${name_prefix}" \
    location="${location}" \
    hostVmSize="${vm_size}" \
    hostVolumeSizeGiB="${host_volume_size_gib}" \
    jailerVolumeSizeGiB="${jailer_volume_size_gib}" \
    adminSshPublicKey="${ssh_public_key}" \
    artifactStorageName="${artifact_account}" \
    releaseVersion="${release_version}" \
    orchestratorDirectSecret="${direct_secret}" \
    enableBudget="${enable_budget}" \
    budgetAlertEmail="${budget_alert_email}" \
  --output none

# ---------------------------------------------------------------------------
# Artifacts
#
# Uploaded after the stack so the container exists, and before the host is
# restarted so a rebooting host finds a complete release prefix rather than a
# half-uploaded one.
# ---------------------------------------------------------------------------

upload() {
  az storage blob upload \
    --account-name "${artifact_account}" \
    --container-name releases \
    --name "${release_version}/$(basename "$1")" \
    --file "$1" \
    --overwrite --auth-mode login --only-show-errors --no-progress >/dev/null
}

echo "==> Uploading release ${release_version}"
for artifact in "${build_dir}"/*; do
  [[ -f "${artifact}" ]] && upload "${artifact}"
done
upload "${repo_root}/infra/aws/scripts/bootstrap-host.sh"
upload "${repo_root}/infra/aws/scripts/verify-lifecycle.sh"

# The container the host syncs Caddy's certificates into. Created here rather
# than in the template because the template would recreate it empty on a
# stack replacement, and losing it means re-requesting every certificate.
az storage container create \
  --account-name "${artifact_account}" --name caddy-data \
  --auth-mode login --only-show-errors >/dev/null || true

# ---------------------------------------------------------------------------
# Roll an existing host onto the new release
#
# An already-running host read its ReleaseVersion tag at its last boot, so the
# tag the stack just updated means nothing to it until it restarts; the
# bootstrap is a systemd unit precisely so a restart re-runs it. This is the
# Azure equivalent of CloudFormation replacing the EC2 instance on a UserData
# change, minus the replacement.
#
# A host this run just created is skipped, and that is not an optimisation: it
# is already booting, already on the right tag, and already partway through
# its bootstrap. Restarting it SIGTERMs that bootstrap halfway through
# installing Firecracker.
#
# Either way this comes after the upload, so a host can never reboot into a
# release prefix that is still half-written.
# ---------------------------------------------------------------------------

if [[ "${host_existed}" == "true" ]]; then
  echo "==> Restarting the existing host onto ${release_version}"
  az vm restart \
    --resource-group "${resource_group}" \
    --name "${name_prefix}-host" \
    --only-show-errors --output none
else
  echo "==> Host was created by this deploy; it is already bootstrapping ${release_version}"
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

host_ip="$(az deployment group show \
  --resource-group "${resource_group}" \
  --name "codev-runtime-${release_version}" \
  --query properties.outputs.hostPublicIp.value -o tsv)"
key_id="$(az deployment group show \
  --resource-group "${resource_group}" \
  --name "codev-runtime-${release_version}" \
  --query properties.outputs.credentialKeyId.value -o tsv)"

cat <<SUMMARY

Runtime deployed. Set these in the Vercel project:

  CLOUD_PROVIDER=azure
  AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)
  AZURE_SUBSCRIPTION_ID=${subscription_id}
  AZURE_RESOURCE_GROUP=${resource_group}
  CREDENTIAL_KEY_VAULT_KEY_ID=${key_id}
  ORCHESTRATOR_DIRECT_URL=https://${host_ip//./-}.nip.io
  ORCHESTRATOR_DIRECT_SECRET=<the value in Key Vault: orchestrator-direct-secret>

AZURE_CLIENT_ID is the app registration apps/web federates into; it is not
printed here because it is not created by this script.
SUMMARY
