// A generation owns ephemeral compute. The lifecycle controller owns the disk
// and must fence attachment before submitting this incremental deployment.
targetScope = 'resourceGroup'

param location string = 'westus2'
@minLength(1)
@maxLength(40)
param instanceName string
param workspaceId string
@minValue(1)
param generation int
param imageVersionId string
param dataDiskResourceId string
param adminSshPublicKey string
param adminUsername string = 'codevadmin'

var tags = {
  Project: 'CoDev'
  Runtime: 'arm-workspace'
  WorkspaceId: workspaceId
  Generation: string(generation)
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${instanceName}-nsg'
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

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${instanceName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.242.0.0/16'] }
    subnets: [{
      name: 'workspace'
      properties: {
        addressPrefix: '10.242.0.0/24'
        defaultOutboundAccess: false
      }
    }]
  }
}

// Explicit outbound connectivity only. No inbound rule, including SSH.
resource ip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${instanceName}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${instanceName}-nic'
  location: location
  tags: tags
  properties: {
    enableAcceleratedNetworking: true
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [{
      name: 'primary'
      properties: {
        privateIPAllocationMethod: 'Dynamic'
        subnet: { id: '${vnet.id}/subnets/workspace' }
        publicIPAddress: { id: ip.id }
      }
    }]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: instanceName
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: 'Standard_D2ps_v6' }
    storageProfile: {
      imageReference: { id: imageVersionId }
      osDisk: {
        name: '${instanceName}-os'
        createOption: 'FromImage'
        deleteOption: 'Delete'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
      dataDisks: [{
        lun: 0
        createOption: 'Attach'
        caching: 'None'
        deleteOption: 'Detach'
        managedDisk: { id: dataDiskResourceId }
      }]
    }
    osProfile: {
      computerName: instanceName
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: { publicKeys: [{ path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: adminSshPublicKey }] }
      }
    }
    networkProfile: {
      networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Delete' } }]
    }
  }
}

output vmResourceId string = vm.id
output dataDiskId string = dataDiskResourceId
