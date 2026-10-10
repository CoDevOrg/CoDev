param location string = resourceGroup().location
param image string
param environmentName string = 'codev-web-environment'
param registryName string = 'codevwebprod8ad43'
param identityName string = 'codev-web-origin'
@secure()
param runtimeValues object
// Unique per deploy. Secret values change without changing the template, and
// only a new revision makes replicas read them, so this plain value forces one.
param deploymentId string

var runtimeEnv = [for pair in items(runtimeValues): union({ name: pair.key }, empty(pair.value)
  ? { value: '' }
  : { secretRef: toLower(replace(pair.key, '_', '-')) })]

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: environmentName
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: identityName
}
resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'codev-web-origin'
  location: location
  tags: { application: 'codev', purpose: 'web-origin' }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [for pair in filter(items(runtimeValues), entry => !empty(entry.value)): {
        name: toLower(replace(pair.key, '_', '-'))
        // items() loses the linter's taint tracking; runtimeValues is @secure.
        #disable-next-line use-secure-value-for-secure-inputs
        value: runtimeValues[pair.key]
      }]
    }
    template: {
      terminationGracePeriodSeconds: 30
      containers: [{
        name: 'web'
        image: image
        resources: { cpu: 1, memory: '2Gi' }
        env: concat(runtimeEnv, [{ name: 'CODEV_DEPLOYMENT_ID', value: deploymentId }])
        probes: [
          { type: 'Startup', httpGet: { path: '/__codev/live', port: 3000 }, periodSeconds: 5, failureThreshold: 60 }
          { type: 'Liveness', httpGet: { path: '/__codev/live', port: 3000 }, periodSeconds: 15, failureThreshold: 3 }
          { type: 'Readiness', httpGet: { path: '/__codev/ready', port: 3000 }, periodSeconds: 15, timeoutSeconds: 6, failureThreshold: 3 }
        ]
      }]
      scale: {
        minReplicas: 2
        maxReplicas: 6
        rules: [
          { name: 'http', http: { metadata: { concurrentRequests: '20' } } }
          { name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '70' } } }
        ]
      }
    }
  }
}
output hostname string = app.properties.configuration.ingress.fqdn
