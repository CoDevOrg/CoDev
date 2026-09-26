# CoDev runtime on Azure

The CoDev runtime: one Firecracker host VM, its network, key vault, artifact
storage and monitoring. [`infra/runtime`](../runtime) holds the cloud-neutral
half — the host bootstrap and the Orca build scripts this stack deploys.

## This used to be one of two stacks

The runtime ran on EC2 until it was migrated here, and for a while both stacks
shipped at once: `apps/web` dispatched on a `CLOUD_PROVIDER` variable, so
flipping it moved the runtime and flipping it back moved it home. That
reversibility is spent — the AWS account holds no stack, no instance, no
bucket and no role for CoDev any more, and every stored credential has been
re-wrapped onto Key Vault. The dispatch, the EC2 implementation, the
CloudFormation templates and the re-wrap script are all deleted.

What remains worth knowing is why some of this looks the way it does, because
several decisions here are reactions to how the EC2 host behaved.

**There is no API Gateway or Lambda proxy.** On AWS, `apps/web` signed
requests with SigV4 to API Gateway, which forwarded to a Lambda, which reached
the host over a security-group-restricted path. That proxy had a hard,
non-configurable 29-second timeout, and an authenticated Codex turn can run
for 900 seconds — which is the entire reason `ORCHESTRATOR_DIRECT_URL` was
built as a bypass. It is now simply the path: `apps/web` calls Caddy on the
host over TLS with the shared secret. The variable keeps its "direct" name
from when there was something to be direct _about_.

**The host has to deallocate itself.** An EC2 instance carries
`InstanceInitiatedShutdownBehavior: stop`, so the orchestrator's idle timer
running `systemctl poweroff` stopped the instance and stopped the bill. An
Azure VM shut down from inside the guest stays _allocated_ and keeps charging
for its cores. The orchestrator therefore calls
`/usr/local/sbin/codev-host-poweroff`, which asks ARM to deallocate, and the
VM's managed identity holds Virtual Machine Contributor scoped to itself so it
can. Getting this wrong produces a host that looks off and costs full price.

**The VM size is load-bearing.** Firecracker needs `/dev/kvm`. The default
`Standard_D8s_v7` provides 8 vCPUs and 32 GiB for the six-sandbox development
target. With the current 2-vCPU guest default, six guests can contend for CPU
during simultaneous compile-heavy work; this size is the lower-cost interactive
dev target, not a guarantee of six dedicated guest cores. The Dsv7 Intel series
supports nested virtualization; `D2s_v7` was the size previously smoke-tested
with `vmx` and `kvm_intel`. Verify `/dev/kvm` and
start a guest after resizing, since a size without nested virtualization
provisions perfectly but cannot start a microVM. Note also that 850 of 1,333
sizes are restricted on this subscription, including the whole x86 B-family,
so there is no cheap burstable tier here.

## The bootstrap

`infra/runtime/scripts/bootstrap-host.sh` builds the host. It used to serve two
clouds, with four operations behind a `CODEV_CLOUD` shim — fetching an
artifact, reading the host's public IP, reading the direct secret, and syncing
Caddy's certificates — and roughly 600 cloud-agnostic lines around them. The
shim is gone; those 600 lines are the whole file now.

It lives under `infra/runtime/` rather than `infra/azure/` because it is also
what the `verify-runtime` CI job and `pnpm orca:web` build against, and because
the directory it used to sit in was named `infra/aws/` long after it had
stopped being about AWS.

One leftover: cloud-init still exports `CODEV_CLOUD=azure` into the host's
environment file. Nothing reads it. It stays because `osProfile.customData` is
immutable on an existing VM (see below), so removing that line would force a
host replacement to delete a variable that costs nothing.

## Changing cloud-init or the host image means replacing the VM

`osProfile.customData` and `storageProfile.imageReference` are immutable on an
existing Azure VM — a deployment carrying a different value is rejected with
`PropertyChangeNotAllowed`, where EC2 UserData and AMIs can be updated in
place. A normal deployment preserves the host's current gallery image when
`CODEV_HOST_IMAGE_ID` is unset. To promote a different image, set that
variable; `deploy.sh` replaces the host before applying the template:

```bash
CODEV_HOST_IMAGE_ID=<gallery-image-version-resource-id> \
./infra/azure/deploy.sh
```

The VM's OS and bootstrap-owned jailer disk carry `deleteOption: Delete`, but
workspace disks are attached with `deleteOption: Detach` and survive host
replacement. The release version travels as a VM tag instead, read back
through IMDS, so rolling a new release forward is just a tag update and a
restart. Treat cloud-init as the bootstrap-of-the-bootstrap: if a change can
go in `bootstrap-host.sh`, put it there, because that one ships as a blob and
needs no replacement.

### The bootstrap unit must hang off `cloud-init.target`

The bootstrap re-runs on every boot because it is a systemd unit, and that
unit is `WantedBy=cloud-init.target`, not `multi-user.target`. This is not a
style choice. `cloud-init.target` is itself ordered `After=multi-user.target`,
so a unit that multi-user wants _and_ that waits on cloud-init is an ordering
cycle. systemd breaks cycles by deleting a job, and the job it deletes is the
bootstrap's. The result is silent: the unit shows `enabled`, the first boot
looks fine because `runcmd` started it by hand, and every boot after that
skips it. A "rolled" host reboots onto whatever it already had, still tagged
with the new release.

If you change the unit, check a real reboot, not `what-if` and not the first
boot. `journalctl -b -u codev-bootstrap.service` on the rebooted host should
show it running; a line containing `ordering cycle` means it did not.

### The bootstrap re-runs, but it does not reinstall

Re-running on every boot is what makes a release roll forward, and it used to
mean a full reinstall each time: apt, Node, the agent CLIs, the Cursor
installer, the Orca tarball, Caddy, Firecracker, and a 3 GB guest rootfs
rebuilt from a freshly downloaded Ubuntu squashfs. That is minutes of work,
and because `codev-orchestrator` only starts once the script finishes, every
one of those minutes landed on whoever was sitting in front of an opening
workspace. The host is deallocated after a short quiet window to save compute,
so reopened workspaces need a cold host start.

So each of those stages now declares a key over its own inputs and runs only
when the key differs from what the last successful run recorded, under
`/var/lib/codev/bootstrap-stamps`. A release roll changes the keys and
reinstalls what actually moved; a plain reboot changes none of them and goes
straight to the service restarts at the end. Firecracker guests hibernate
after 15 idle minutes and keep their workspace disks. With no sandbox or
recently used IDE session, the host deallocates after one quiet minute.
`CODEV_BOOTSTRAP_FORCE=1` runs everything regardless, which is the thing to
reach for when a host is in a state nobody can explain. The rules for adding a
stage are in the script, next to the helpers.

### Rolling a host that is off

The host deallocates itself after one quiet minute without an active sandbox
or recently used IDE session, so a deploy usually finds
it off. `deploy.sh` checks the power state: a running host is restarted, a
deallocated one is started. Both re-run the bootstrap, and both read the new
`ReleaseVersion` tag. `az vm restart` alone refuses a deallocated VM, which
would make the routine deploy fail precisely when nobody is using the runtime.

Note that the public IP, Key Vault, storage account and the user-assigned
identity all survive a host replacement, so it costs a few minutes rather
than a reconfiguration.

## Building and promoting a golden host image

Phase 3 adds an explicit Azure Image Builder path. It is intentionally separate
from the normal runtime deploy: image creation is expensive, so a runtime
release can continue using stock Ubuntu until the image has passed its smoke
validation.

After the runtime release has been uploaded, run the **Build runtime image
(Azure)** workflow manually, or run the script locally:

```bash
AZURE_RESOURCE_GROUP=codev-runtime-migration \
AZURE_SUBSCRIPTION_ID=<subscription-id> \
CODEV_RELEASE_VERSION=<uploaded-release-prefix> \
CODEV_IMAGE_VERSION=1.0.1 \
./infra/azure/build-host-image.sh
```

The script uploads the credential-free image provisioner, deploys
`image-builder.bicep`, starts the Image Builder run, waits for the gallery
version and prints its exact `CODEV_HOST_IMAGE_ID`. Promote that immutable
version on a later runtime deployment:

```bash
CODEV_HOST_IMAGE_ID=<gallery-image-version-resource-id> \
./infra/azure/deploy.sh
```

Keep the previous version ID for rollback. The gallery image contains stable
host dependencies, Orca, Firecracker, the guest kernel, and the prepared guest
rootfs. It does not contain credentials, certificates, repositories, member
state, or the deployment's public hostname. The mutable bootstrap still
installs release-specific services and configures the host after boot.

## Deploying

```bash
AZURE_RESOURCE_GROUP=codev-runtime-migration ./infra/azure/deploy.sh
```

In CI this runs from
[`.github/workflows/deploy-runtime-azure.yml`](../../.github/workflows/deploy-runtime-azure.yml)
on pushes to `main`, authenticating through OIDC. There is no Azure client
secret in the repository: the app registration trusts GitHub's token through a
federated credential matched on the token's subject.

That subject is not the form most examples show. CoDevOrg emits
**immutable-identifier** subject claims, so the `deploy` job (which runs in
the `production` environment) presents

```
repo:CoDevOrg@320302482/CoDev@1315384847:environment:production
```

and a credential registered as `repo:CoDevOrg/CoDev:environment:production`
never matches; the login fails with `AADSTS700213: No matching federated
identity record found`. The first CI deploy failed exactly this way. Register
the credential with the id-bearing subject:

```bash
az ad app federated-credential create --id <AZURE_CLIENT_ID> --parameters '{
  "name": "github-production-ids",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:CoDevOrg@320302482/CoDev@1315384847:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Those numeric ids are the GitHub org and repository ids, not names, so a
rename is safe and a recreation is not: if the org or repo is ever recreated,
this subject has to be updated to match.

Required repository variables:

| Variable                    | Value                             |
| --------------------------- | --------------------------------- |
| `AZURE_CLIENT_ID`           | App registration's application id |
| `AZURE_TENANT_ID`           | Directory id                      |
| `AZURE_SUBSCRIPTION_ID`     | Target subscription               |
| `AZURE_RESOURCE_GROUP`      | Resource group to deploy into     |
| `CODEV_HOST_SSH_PUBLIC_KEY` | Key authorised on the host        |

### The deploy principal needs a data-plane role, not just Contributor

Azure separates control-plane RBAC from data-plane RBAC, and this catches
people out: **Contributor lets you create a storage account but not write a
blob into it.** Uploading the release fails with "You do not have the
required permissions needed to perform this operation" until whoever runs
the deploy — the CI service principal, and any human running `deploy.sh`
locally — also holds **Storage Blob Data Contributor**.

This cannot live in `main.bicep`, because the template would have to grant
the role to the very principal already deploying it. Grant it once per
principal:

```bash
az role assignment create \
  --assignee-object-id <principal object id> \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/<sub>/resourceGroups/<rg>
```

Creating a role assignment itself needs Owner or User Access Administrator
on the scope; plain Contributor cannot grant roles, including to itself.

### The deploy principal also has to be able to grant the host its roles

`main.bicep` assigns three roles to the host's managed identity (Key Vault
Secrets User on the vault, Storage Blob Data Reader on the artifact account,
Virtual Machine Contributor on the host itself). Applying the template
therefore needs `Microsoft.Authorization/roleAssignments/write`, which
Contributor does not include. The first CI deploy failed exactly there with
`InvalidTemplateDeployment ... Authorization failed for template resource ...
of type 'Microsoft.Authorization/roleAssignments'`, after working every time
from a laptop whose user happened to be Owner.

Grant the deploy principal **Role Based Access Control Administrator** on the
resource group, constrained so it can only hand out those three roles and
nothing broader:

```bash
az role assignment create \
  --assignee-object-id <deploy principal object id> \
  --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" \
  --scope /subscriptions/<sub>/resourceGroups/<rg> \
  --condition-version 2.0 \
  --condition "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {4633458b-17de-408a-b874-0445c86b69e6, 2a2b9908-6ea1-4ae2-8e65-a410df84e7d1, 9980e02c-c2be-4d73-94e8-173b1dc7cf3c})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {4633458b-17de-408a-b874-0445c86b69e6, 2a2b9908-6ea1-4ae2-8e65-a410df84e7d1, 9980e02c-c2be-4d73-94e8-173b1dc7cf3c}))"
```

The three GUIDs are the built-in role definition ids of Key Vault Secrets
User, Storage Blob Data Reader and Virtual Machine Contributor.

### Persistent workspace disk canary permissions

Phase 5 canary storage is created and attached by the `apps/web` Azure
identity (`AZURE_CLIENT_ID`), not by the host identity. Before setting
`CODEV_WORKSPACE_PERSISTENT_STORAGE_ENABLED=true`, grant that principal
**Virtual Machine Contributor** on the runtime resource group. It needs to
create managed disks and attach/detach them from the assigned host. Also set
`AZURE_RUNTIME_LOCATION` to the resource group's region and leave the canary
disabled until a host-replacement test has verified the workspace state.

## Credential envelopes

Every stored provider credential is wrapped by the Key Vault key above and
carries an `akv-v1` prefix. `decryptSecret` dispatches on that prefix rather
than on any configured provider, which is what allowed the AWS-wrapped
`kms-v1` format to be read throughout the migration and then dropped once
production held none of it. The AWS key is scheduled for deletion and nothing
depends on it.

The other format still read is `v1`, the local development envelope an
unconfigured checkout writes. Production refuses to write it.
