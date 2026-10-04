targetScope = 'resourceGroup'

@description('Existing ARM artifact account. Its identity already has Blob Data Contributor.')
param artifactStorageName string

resource account 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: artifactStorageName
}

resource service 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' existing = {
  parent: account
  name: 'default'
}

resource state 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: service
  name: 'arm-workspace-state'
  properties: {
    publicAccess: 'None'
  }
}

output containerId string = state.id
