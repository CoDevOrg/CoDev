// CoDev runtime on Azure — the Firecracker host and everything around it.
//
// This is the port of infra/aws/cloudformation/runtime.yaml. The resource
// list maps across almost one-to-one (VNet for VPC, Key Vault for KMS, Blob
// for S3, Azure Monitor for CloudWatch), with one deliberate difference:
// AWS fronts the orchestrator with API Gateway + a Lambda proxy, and that
// proxy carries a non-configurable 29-second timeout that long Codex turns
// cannot live inside — which is exactly why ORCHESTRATOR_DIRECT_URL exists
// on the AWS side as a bypass. Azure has no equivalent tier here at all:
// apps/web talks to Caddy on the host over TLS with the shared secret, the
// path the AWS deployment already uses for its long calls. That removes the
// timeout instead of routing around it, and removes a tier of infrastructure
// with it.

targetScope = 'resourceGroup'

@description('Short name prefix for every resource in the stack.')
param namePrefix string = 'codev-runtime'

@description('Region for all resources. Nested virtualization must be available here.')
param location string = resourceGroup().location

@description('VM size for the Firecracker host. MUST support nested virtualization: Firecracker needs /dev/kvm. Verified on Standard_D2s_v7 (Intel, vmx exposed). AMD sizes and the B-family are not safe defaults.')
param hostVmSize string = 'Standard_D2s_v7'

@description('OS disk size in GiB.')
param hostVolumeSizeGiB int = 64

@description('Size of the dedicated jailer data disk. Formatted XFS with reflinks by the bootstrap script, which is what lets microVM rootfs clones be copy-on-write.')
param jailerVolumeSizeGiB int = 128

@description('Admin username for the host. Password auth is disabled; this exists only to own the SSH key.')
param adminUsername string = 'codev'

@description('SSH public key authorised on the host.')
@secure()
param adminSshPublicKey string

@description('Storage account name for release artifacts. Must be globally unique, 3-24 lowercase alphanumeric.')
param artifactStorageName string

@description('Release version the host boots. The bootstrap script pulls artifacts from this prefix.')
param releaseVersion string

@description('Shared secret apps/web presents to Caddy on the host. Stored in Key Vault, never in a template parameter file.')
@secure()
param orchestratorDirectSecret string

@description('Create a Consumption budget. Requires billing-scope permission, which a Contributor on a sponsorship subscription may not have, so this defaults off and the stack still deploys without it.')
param enableBudget bool = false

@description('Monthly budget in USD, when enableBudget is true.')
param monthlyBudgetUsd int = 200

@description('Address notified when the budget threshold trips.')
param budgetAlertEmail string = ''

@description('First day of the budget period. Defaults to the first of the current month; utcNow() is only legal in a parameter default, which is why this is a parameter rather than a variable.')
param budgetStartDate string = '${substring(utcNow('yyyy-MM-dd'), 0, 8)}01'

var tags = {
  Project: 'CoDev'
  ManagedBy: 'Bicep'
}

var vnetCidr = '10.42.0.0/16'
var subnetCidr = '10.42.0.0/24'

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

// Browsers connect straight to Caddy on the host for Orca IDE's WebSocket
// protocol, so 80 and 443 are genuinely public. 80 is not decorative: Caddy
// needs it for the Let's Encrypt HTTP-01 challenge. The orchestrator's own
// port 8080 is never exposed — Caddy terminates TLS and proxies to it on
// loopback, so there is no rule for it here and no way to reach it directly.
resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${namePrefix}-host-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowCaddyHttp'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
          description: 'Let\'s Encrypt HTTP-01 challenge for Caddy.'
        }
      }
      {
        name: 'AllowCaddyHttps'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
          description: 'Orca IDE WebSocket and the orchestrator control API.'
        }
      }
      {
        name: 'AllowSsh'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
          description: 'Operator access. Key-only; password auth is disabled on the host.'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
          description: 'Explicit floor so a future rule cannot widen the surface by accident.'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetCidr] }
    subnets: [
      {
        name: 'host'
        properties: {
          addressPrefix: subnetCidr
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

// Static, not dynamic. The AWS stack uses an Elastic IP for exactly one
// reason and it applies here unchanged: the host stops when idle and starts
// again on wake, but the nip.io hostname Orca advertises to browsers and
// Caddy's TLS certificate are both derived once on first boot. An address
// that changed across a stop would silently strand every IDE session behind
// a hostname that no longer resolves to the host.
resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${namePrefix}-host-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${namePrefix}-host-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: publicIp.id }
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Key Vault — replaces the KMS key and the SSM parameter in one resource
// ---------------------------------------------------------------------------

// RBAC mode rather than access policies: the CI principal and the host's
// managed identity are both granted through role assignments, which is the
// same model the rest of this stack uses and avoids a second, parallel
// permission system that drifts.
resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: '${namePrefix}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Credentials live here. A purge would be unrecoverable, not merely
    // inconvenient, so the vault refuses one outright.
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// Envelope-encryption key for provider credentials. The AWS side wraps a
// per-secret AES-256 data key with KMS; apps/web/lib/azure-kms.ts does the
// same wrap/unwrap against this key, so the envelope format and the
// per-secret data key both survive the move.
resource credentialKey 'Microsoft.KeyVault/vaults/keys@2024-11-01' = {
  parent: vault
  name: 'codev-credentials'
  properties: {
    kty: 'RSA'
    keySize: 3072
    keyOps: ['wrapKey', 'unwrapKey']
    rotationPolicy: {
      lifetimeActions: [
        {
          trigger: { timeBeforeExpiry: 'P30D' }
          action: { type: 'notify' }
        }
      ]
      attributes: { expiryTime: 'P2Y' }
    }
  }
}

resource directSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: vault
  name: 'orchestrator-direct-secret'
  properties: {
    value: orchestratorDirectSecret
    contentType: 'text/plain'
  }
}

// ---------------------------------------------------------------------------
// Artifact storage — replaces the S3 release bucket
// ---------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: artifactStorageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storage
  name: 'default'
}

resource releasesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'releases'
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------------------
// Observability — replaces the CloudWatch log group, alarms and dashboard
// ---------------------------------------------------------------------------

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2024-10-01-preview' = if (!empty(budgetAlertEmail)) {
  name: '${namePrefix}-alerts'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'codevrt'
    enabled: true
    emailReceivers: [
      {
        name: 'operator'
        emailAddress: budgetAlertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

// The AWS equivalent is FirecrackerHostStatusAlarm on StatusCheckFailed.
// Azure's nearest signal is the VM availability metric, which reports 0 when
// the platform considers the VM unavailable.
resource hostAvailabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(budgetAlertEmail)) {
  name: '${namePrefix}-host-unavailable'
  location: 'global'
  tags: tags
  properties: {
    description: 'The Firecracker host is reporting unavailable.'
    severity: 1
    enabled: true
    scopes: [host.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Availability'
          metricNamespace: 'Microsoft.Compute/virtualMachines'
          metricName: 'VmAvailabilityMetric'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// ---------------------------------------------------------------------------
// The Firecracker host
// ---------------------------------------------------------------------------

// cloud-init rather than EC2 UserData, doing the same three jobs: settle the
// clock, fetch the bootstrap script from the artifact container, and hand it
// the release coordinates. Azure CLI replaces AWS CLI for the download,
// authenticating as the VM's own managed identity so no key is baked into
// the image or the template.
// cloud-init, and deliberately free of anything that changes between
// deploys.
//
// Azure treats osProfile.customData as immutable once a VM exists: a second
// deployment carrying a different value is rejected outright with
// PropertyChangeNotAllowed, where EC2 UserData can simply be updated. So the
// release version must not live in here -- baking it in makes the first
// deploy succeed and every later one fail. It travels as a VM tag instead,
// which is mutable, and the boot script reads it back through IMDS. The only
// substitutions below are values fixed for the life of the stack.
var cloudInitTemplate = '''#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - chrony
  - xfsprogs
  - jq
write_files:
  - path: /etc/codev/bootstrap.env
    permissions: '0600'
    content: |
      CODEV_CLOUD=azure
      CODEV_ARTIFACT_ACCOUNT=__ARTIFACT_ACCOUNT__
      CODEV_KEY_VAULT_NAME=__KEY_VAULT_NAME__
      CODEV_HOST_ARCH=x86_64
  - path: /usr/local/sbin/codev-fetch-bootstrap.sh
    permissions: '0700'
    content: |
      #!/bin/bash
      set -euxo pipefail
      set -a
      . /etc/codev/bootstrap.env
      set +a
      timedatectl set-ntp true
      systemctl restart chrony
      chronyc -a makestep
      chronyc waitsync 60 1.0 0.0 2
      export DEBIAN_FRONTEND=noninteractive
      command -v az >/dev/null || curl -sL https://aka.ms/InstallAzureCLIDeb | bash
      until az login --identity >/dev/null 2>&1; do sleep 5; done
      # The release to run comes from this VM's own ReleaseVersion tag, which
      # the deploy updates in place. Reading it at boot rather than baking it
      # into customData is what lets the same VM be rolled forward.
      CODEV_RELEASE_VERSION="$(curl -fsS -H 'Metadata: true' \
        'http://169.254.169.254/metadata/instance/compute/tagsList?api-version=2021-02-01' \
        | jq -r '.[] | select(.name=="ReleaseVersion") | .value')"
      export CODEV_RELEASE_VERSION
      test -n "$CODEV_RELEASE_VERSION"
      until az storage blob download \
        --account-name "$CODEV_ARTIFACT_ACCOUNT" \
        --container-name releases \
        --name "$CODEV_RELEASE_VERSION/bootstrap-host.sh" \
        --file /tmp/codev-bootstrap-host.sh \
        --auth-mode login; do
        sleep 10
      done
      chmod 0700 /tmp/codev-bootstrap-host.sh
      exec /tmp/codev-bootstrap-host.sh
  - path: /etc/systemd/system/codev-bootstrap.service
    permissions: '0644'
    content: |
      [Unit]
      Description=Fetch and run the CoDev host bootstrap
      After=network-online.target
      Wants=network-online.target

      [Service]
      Type=oneshot
      RemainAfterExit=yes
      ExecStart=/usr/local/sbin/codev-fetch-bootstrap.sh

      [Install]
      WantedBy=multi-user.target
runcmd:
  - [ systemctl, enable, --now, codev-bootstrap.service ]
'''

// A boot-time service rather than a bare runcmd, because cloud-init's runcmd
// fires only on a VM's very first boot. Rolling a release works by updating
// the tag and restarting the host, so the bootstrap has to run every boot.
var cloudInit = replace(
  replace(cloudInitTemplate, '__ARTIFACT_ACCOUNT__', artifactStorageName),
  '__KEY_VAULT_NAME__',
  '${namePrefix}-kv'
)

resource host 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${namePrefix}-host'
  location: location
  tags: union(tags, {
    Name: 'codev-firecracker-host'
    // Mutable, unlike customData. The boot script reads this back through
    // IMDS to decide which release to install.
    ReleaseVersion: releaseVersion
  })
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: hostVmSize }
    osProfile: {
      computerName: 'codev-firecracker-host'
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: adminSshPublicKey
            }
          ]
        }
        patchSettings: {
          patchMode: 'ImageDefault'
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: hostVolumeSizeGiB
        managedDisk: { storageAccountType: 'Premium_LRS' }
        deleteOption: 'Delete'
      }
      // Separate disk for the jailer tree, matching /dev/sdf on the AWS host.
      // bootstrap-host.sh formats it XFS with reflink=1 and refuses to start
      // without that, because microVM rootfs clones are reflink copies.
      dataDisks: [
        {
          lun: 0
          createOption: 'Empty'
          diskSizeGB: jailerVolumeSizeGiB
          managedDisk: { storageAccountType: 'Premium_LRS' }
          deleteOption: 'Delete'
          caching: 'None'
        }
      ]
    }
    networkProfile: {
      networkInterfaces: [{ id: nic.id }]
    }
    diagnosticsProfile: {
      bootDiagnostics: { enabled: true }
    }
  }
}

// ---------------------------------------------------------------------------
// Access for the host's own identity
// ---------------------------------------------------------------------------

var keyVaultSecretsUser = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var storageBlobDataReader = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
)
var virtualMachineContributor = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '9980e02c-c2be-4d73-94e8-173b1dc7cf3c'
)

// The host reads the direct secret at boot instead of receiving it through
// the template, which is how the AWS side delivers it via SSM. Nothing
// sensitive ends up in deployment history either way.
resource hostReadsSecret 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, host.id, 'kv-secrets-user')
  scope: vault
  properties: {
    roleDefinitionId: keyVaultSecretsUser
    principalId: host.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource hostReadsArtifacts 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, host.id, 'blob-reader')
  scope: storage
  properties: {
    roleDefinitionId: storageBlobDataReader
    principalId: host.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// The host deallocates *itself* when the orchestrator's idle timer fires, so
// it needs control-plane rights over its own VM resource and nothing else.
// This is the Azure cost of a difference in platform behaviour: on EC2 the
// guest simply powers off and the instance stops, needing no IAM at all,
// whereas an Azure VM that powers itself off stays allocated and billing.
// Scoped to this one VM, not the resource group.
resource hostDeallocatesItself 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(host.id, 'self-deallocate')
  scope: host
  properties: {
    roleDefinitionId: virtualMachineContributor
    principalId: host.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Budget — off by default, see the parameter's note
// ---------------------------------------------------------------------------

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = if (enableBudget && !empty(budgetAlertEmail)) {
  name: '${namePrefix}-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetUsd
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      Actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: [budgetAlertEmail]
        thresholdType: 'Actual'
      }
      Forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: [budgetAlertEmail]
        thresholdType: 'Forecasted'
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs — the values apps/web and the deploy script need
// ---------------------------------------------------------------------------

output hostName string = host.name
output hostResourceId string = host.id
output hostPublicIp string = publicIp.properties.ipAddress
output keyVaultName string = vault.name
output keyVaultUri string = vault.properties.vaultUri
output credentialKeyId string = credentialKey.properties.keyUriWithVersion
output artifactAccount string = storage.name
output logWorkspaceId string = logs.id
output releaseVersionDeployed string = releaseVersion
