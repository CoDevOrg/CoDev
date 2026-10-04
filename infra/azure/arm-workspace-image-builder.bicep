// Native candidate builder for the standalone ARM64 workspace VM. Isolated
// from image-builder.bicep/codev-host; never promotes production.
targetScope = 'resourceGroup'

@description('Prefix for resources in the dedicated ARM workspace image resource group.')
param namePrefix string = 'codev-arm-workspace'

param location string = resourceGroup().location
param artifactStorageName string
param releaseVersion string
param imageVersion string
@description('Ephemeral administrative public key; private key stays on the runner.')
param builderSshPublicKey string
param builderAdminUsername string = 'codevbuilder'

@description('Ubuntu 24.04 ARM64 marketplace image SKU.')
param sourceImageSku string = 'server-arm64'

@description('Pinned Canonical Ubuntu 24.04 ARM64 image version.')
param sourceImageVersion string = '24.04.202609040'

@description('ARM64 VM used only by the isolated native image builder.')
param imageBuilderVmSize string = 'Standard_D4ps_v6'

var tags = {
  Project: 'CoDev'
  ManagedBy: 'GitHubActions'
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
    features: [
      { name: 'SecurityType', value: 'TrustedLaunchSupported' }
    ]
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

var builderName = '${namePrefix}-build-${replace(imageVersion, '.', '-')}'

resource networkSecurityGroup 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${builderName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [{
      name: 'DenyAllInbound'
      properties: {
        priority: 100
        direction: 'Inbound'
        access: 'Deny'
        protocol: '*'
        sourcePortRange: '*'
        destinationPortRange: '*'
        sourceAddressPrefix: '*'
        destinationAddressPrefix: '*'
      }
    }]
  }
}

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${builderName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.241.0.0/16'] }
    subnets: [{
      name: 'builder'
      properties: { addressPrefix: '10.241.0.0/24' }
    }]
  }
}

// Explicit outbound connectivity for apt/npm/GitHub; inbound is denied.
resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${builderName}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource networkInterface 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${builderName}-nic'
  location: location
  tags: tags
  properties: {
    enableAcceleratedNetworking: true
    networkSecurityGroup: { id: networkSecurityGroup.id }
    ipConfigurations: [{
      name: 'primary'
      properties: {
        privateIPAllocationMethod: 'Dynamic'
        subnet: { id: '${virtualNetwork.id}/subnets/builder' }
        publicIPAddress: { id: publicIp.id }
      }
    }]
  }
}

resource builder 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: builderName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${imageBuilderIdentity.id}': {} }
  }
  properties: {
    hardwareProfile: { vmSize: imageBuilderVmSize }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: sourceImageSku
        version: sourceImageVersion
      }
      osDisk: {
        createOption: 'FromImage'
        deleteOption: 'Delete'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    osProfile: {
      computerName: builderName
      adminUsername: builderAdminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: { publicKeys: [{ path: '/home/${builderAdminUsername}/.ssh/authorized_keys', keyData: builderSshPublicKey }] }
      }
    }
    networkProfile: {
      networkInterfaces: [{ id: networkInterface.id, properties: { deleteOption: 'Delete' } }]
    }
  }
  dependsOn: [imageBuilderReadsArtifacts]
}

output builderId string = builder.id
output builderName string = builderName
output imageDefinitionId string = imageDefinition.id
output imageVersionId string = '${imageDefinition.id}/versions/${imageVersion}'
