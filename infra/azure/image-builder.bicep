// Versioned CoDev host image pipeline.
//
// Azure Image Builder customizes a stock Ubuntu image, publishes the result to
// an Azure Compute Gallery, and leaves the runtime deployment in control of
// promotion through main.bicep's optional hostImageId parameter. The template
// identity can read only the release artifacts and write only this gallery.

targetScope = 'resourceGroup'

@description('Short name prefix shared with main.bicep.')
param namePrefix string = 'codev-runtime'

@description('Azure Image Builder must run in a supported region.')
param location string = resourceGroup().location

@description('Existing artifact storage account created by main.bicep.')
param artifactStorageName string

@description('Release prefix containing provision-host-image.sh and runtime artifacts.')
param releaseVersion string

@description('Explicit semver for the gallery image version, for example 1.0.12.')
param imageVersion string

@description('Host architecture baked into this image.')
param hostArchitecture string = 'x86_64'

@description('VM size used only by the temporary Image Builder build VM.')
param imageBuilderVmSize string = 'Standard_D4s_v7'

@description('SHA-256 of the uploaded provision-host-image.sh release artifact.')
param provisionScriptSha256 string

var tags = {
  Project: 'CoDev'
  ManagedBy: 'AzureImageBuilder'
  ReleaseVersion: releaseVersion
  ImageVersion: imageVersion
}
var galleryName = '${replace(namePrefix, '-', '')}gallery'

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
    description: 'Versioned CoDev Firecracker host images'
  }
}

resource imageDefinition 'Microsoft.Compute/galleries/images@2022-03-03' = {
  parent: gallery
  name: 'codev-host'
  location: location
  tags: tags
  properties: {
    osType: 'Linux'
    osState: 'Generalized'
    hyperVGeneration: 'V2'
    architecture: hostArchitecture == 'aarch64' || hostArchitecture == 'arm64' ? 'Arm64' : 'x64'
    identifier: {
      publisher: 'CoDev'
      offer: 'codev-runtime'
      sku: 'firecracker-host'
    }
    description: 'Credential-free CoDev Azure host runtime'
    recommended: {
      vCPUs: { min: 2, max: 8 }
      memory: { min: 8, max: 32 }
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
  name: guid(artifactStorage.id, imageBuilderIdentity.id, 'image-builder-artifacts')
  scope: artifactStorage
  properties: {
    roleDefinitionId: storageBlobDataReader
    principalId: imageBuilderIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource imageBuilderWritesGallery 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(gallery.id, imageBuilderIdentity.id, 'image-builder-gallery')
  scope: gallery
  properties: {
    roleDefinitionId: contributor
    principalId: imageBuilderIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// The Image Builder service identity attaches the same identity to its
// temporary build VM so the provisioner can use `az login --identity`.
// Azure requires Managed Identity Operator on every identity assigned to that
// VM, including this one.
resource imageBuilderOperatesBuildVmIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(imageBuilderIdentity.id, 'image-builder-managed-identity-operator')
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
      sku: 'server'
      version: 'latest'
    }
    vmProfile: {
      vmSize: imageBuilderVmSize
      osDiskSizeGB: 64
      userAssignedIdentities: [imageBuilderIdentity.id]
    }
    customize: [
      {
        type: 'Shell'
        name: 'provision-codev-host'
        scriptUri: '${artifactStorage.properties.primaryEndpoints.blob}releases/${releaseVersion}/provision-host-image.sh'
        sha256Checksum: provisionScriptSha256
      }
    ]
    validate: {
      continueDistributeOnFailure: false
      inVMValidations: [
        {
          type: 'Shell'
          name: 'validate-codev-host'
          inline: [
            'set -eux'
            'test -x /usr/local/bin/codev-orchestrator'
            'test -x /usr/local/bin/codev-guestd'
            'test -x /usr/local/bin/firecracker'
            'test -x /usr/local/bin/jailer'
            'test -x /opt/orca/squashfs-root/AppRun'
            'test -s /var/lib/codev/base/rootfs.ext4'
            'test -s /var/lib/codev/base/vmlinux'
            'systemctl cat codev-orca-xvfb.service >/dev/null'
            'systemctl cat codev-firecracker-network-isolation.service >/dev/null'
          ]
        }
      ]
    }
    distribute: [
      {
        type: 'SharedImage'
        galleryImageId: '${imageDefinition.id}/versions/${imageVersion}'
        runOutputName: 'codev-gallery'
        artifactTags: {
          ReleaseVersion: releaseVersion
          ImageVersion: imageVersion
          HostArchitecture: hostArchitecture
        }
        targetRegions: [
          {
            name: location
            replicaCount: 1
            storageAccountType: 'Standard_ZRS'
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
output imageBuilderIdentityId string = imageBuilderIdentity.id
