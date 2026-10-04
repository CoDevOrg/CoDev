// Candidate images for the standalone ARM64 workspace VM. This template is
// isolated from image-builder.bicep/codev-host and never promotes production.
targetScope = 'resourceGroup'

@description('Prefix for resources in the dedicated ARM workspace image resource group.')
param namePrefix string = 'codev-arm-workspace'

param location string = resourceGroup().location
param artifactStorageName string
param releaseVersion string
param imageVersion string
param provisionScriptSha256 string
@secure()
param provisionScriptUri string

@description('Ubuntu 24.04 ARM64 marketplace image SKU.')
param sourceImageSku string = 'server-arm64'

@description('Pinned Canonical Ubuntu 24.04 ARM64 image version.')
param sourceImageVersion string = '24.04.202609040'

@description('ARM64 VM used only by Azure Image Builder.')
param imageBuilderVmSize string = 'Standard_D4ps_v6'

var tags = {
  Project: 'CoDev'
  ManagedBy: 'AzureImageBuilder'
  Runtime: 'arm-workspace'
  ReleaseVersion: releaseVersion
  ImageVersion: imageVersion
}
var galleryName = 'codevarmworkspacegallery'

resource artifactStorage 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: artifactStorageName
}

resource imageBuilderIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-image-builder'
  location: location
  tags: tags
}

resource gallery 'Microsoft.Compute/galleries@2022-03-03' = {
  name: galleryName
  location: location
  tags: tags
  properties: {
    description: 'Isolated versioned ARM64 CoDev workspace VM images; not the Firecracker host gallery.'
  }
}

resource imageDefinition 'Microsoft.Compute/galleries/images@2022-03-03' = {
  parent: gallery
  name: 'codev-workspace-arm64'
  location: location
  tags: tags
  properties: {
    osType: 'Linux'
    osState: 'Generalized'
    hyperVGeneration: 'V2'
    architecture: 'Arm64'
    identifier: {
      publisher: 'CoDev'
      offer: 'codev-workspace'
      sku: 'ubuntu-24-04-arm64'
    }
    description: 'Standalone per-workspace CoDev ARM64 VM runtime. No credentials or workspace data.'
    recommended: {
      vCPUs: { min: 2, max: 2 }
      memory: { min: 8, max: 8 }
    }
  }
}

var storageBlobDataReader = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
)
var contributor = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b24988ac-6180-42a0-ab88-20f7382dd24c'
)
var managedIdentityOperator = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'f1a07417-d97a-45cb-824c-7a7467783830'
)

resource imageBuilderReadsArtifacts 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(artifactStorage.id, imageBuilderIdentity.id, 'arm-workspace-image-artifacts')
  scope: artifactStorage
  properties: {
    roleDefinitionId: storageBlobDataReader
    principalId: imageBuilderIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource imageBuilderWritesGallery 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(gallery.id, imageBuilderIdentity.id, 'arm-workspace-gallery')
  scope: gallery
  properties: {
    roleDefinitionId: contributor
    principalId: imageBuilderIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource imageBuilderOperatesBuildVmIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(imageBuilderIdentity.id, 'arm-workspace-managed-identity-operator')
  scope: imageBuilderIdentity
  properties: {
    roleDefinitionId: managedIdentityOperator
    principalId: imageBuilderIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource imageTemplate 'Microsoft.VirtualMachineImages/imageTemplates@2023-07-01' = {
  name: '${namePrefix}-image-${imageVersion}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${imageBuilderIdentity.id}': {}
    }
  }
  properties: {
    buildTimeoutInMinutes: 120
    source: {
      type: 'PlatformImage'
      publisher: 'Canonical'
      offer: 'ubuntu-24_04-lts'
      sku: sourceImageSku
      version: sourceImageVersion
    }
    vmProfile: {
      vmSize: imageBuilderVmSize
      userAssignedIdentities: [imageBuilderIdentity.id]
    }
    customize: [
      {
        type: 'Shell'
        name: 'provision-arm-workspace-runtime'
        scriptUri: provisionScriptUri
        sha256Checksum: provisionScriptSha256
      }
    ]
    validate: {
      continueDistributeOnFailure: false
      inVMValidations: [
        {
          type: 'Shell'
          name: 'validate-arm-workspace-runtime'
          inline: [
            'set -eux'
            'test "$(uname -m)" = aarch64'
            'node --version | grep -Eq "^v24\\."'
            'pnpm --version'
            'codex --version'
            'claude --version'
            'test -x /usr/local/bin/codev-guestd'
            'test "$(getent passwd codev-shell | cut -d: -f3)" = 2000'
            'test -L /etc/systemd/system/multi-user.target.wants/workspace.mount'
            'test -L /etc/systemd/system/multi-user.target.wants/codev-guestd.service'
            'node /usr/local/lib/codev/verify-superset-host-artifact.mjs /opt/codev/superset-host'
            'tmp=$(mktemp -d)'
            'CODEV_WORKSPACE_ROOT="$tmp" CODEV_GUESTD_LISTEN_ADDR=127.0.0.1:5252 /usr/local/bin/codev-guestd >/tmp/codev-guestd-image-smoke.log 2>&1 &'
            'pid=$!'
            'trap "kill $pid 2>/dev/null || true; rm -rf $tmp" EXIT'
            'for attempt in $(seq 1 20); do curl -fsS http://127.0.0.1:5252/healthz | jq -e ".status == \\"ok\\"" && break; sleep 1; done'
            'ss -ltnH sport = :5252 | grep -q "127.0.0.1:5252"'
            'kill "$pid"'
            'wait "$pid" || true'
            'trap - EXIT'
            'rm -rf "$tmp"'
          ]
        }
      ]
    }
    distribute: [
      {
        type: 'SharedImage'
        galleryImageId: '${imageDefinition.id}/versions/${imageVersion}'
        runOutputName: 'arm-workspace-gallery'
        artifactTags: {
          ReleaseVersion: releaseVersion
          ImageVersion: imageVersion
          Architecture: 'arm64'
          Runtime: 'standalone-workspace-vm'
        }
        targetRegions: [
          {
            name: location
            replicaCount: 1
            storageAccountType: 'Standard_LRS'
          }
        ]
      }
    ]
  }
  dependsOn: [
    imageBuilderReadsArtifacts
    imageBuilderWritesGallery
    imageBuilderOperatesBuildVmIdentity
  ]
}

output imageTemplateId string = imageTemplate.id
output imageDefinitionId string = imageDefinition.id
output imageVersionId string = '${imageDefinition.id}/versions/${imageVersion}'
