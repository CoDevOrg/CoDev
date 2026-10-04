// Private artifact storage for the isolated ARM workspace image pipeline.
targetScope = 'resourceGroup'

param location string = resourceGroup().location

@minLength(3)
@maxLength(24)
@description('Globally unique lower-case Azure Storage account name.')
param storageName string

resource artifacts 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
  tags: {
    Project: 'CoDev'
    Runtime: 'arm-workspace'
    Purpose: 'candidate-image-artifacts'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: artifacts
  name: 'default'
}

resource releases 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'releases'
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountName string = artifacts.name
output storageAccountId string = artifacts.id
output releasesContainerId string = releases.id
