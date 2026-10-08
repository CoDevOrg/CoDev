// Shared network for every ARM workspace VM in this resource group. Starts
// create only a NIC and an active-only public IP, so they do not wait on a VNet
// and NSG. Deny-all inbound also blocks VM-to-VM traffic inside the subnet.
targetScope = 'resourceGroup'

param location string = 'westus2'

var tags = {
  Project: 'CoDev'
  Runtime: 'arm-workspace-network'
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'codev-arm-workspace-nsg'
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
  name: 'codev-arm-workspace-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.242.0.0/16'] }
    subnets: [{
      name: 'workspace'
      properties: {
        addressPrefix: '10.242.0.0/20'
        defaultOutboundAccess: false
        networkSecurityGroup: { id: nsg.id }
      }
    }]
  }
}

output subnetId string = '${vnet.id}/subnets/workspace'
output nsgId string = nsg.id
