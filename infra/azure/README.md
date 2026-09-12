# CoDev runtime on Azure

The Azure counterpart of [`infra/aws`](../aws). Both can be deployed at once;
`CLOUD_PROVIDER` in `apps/web` decides which one actually serves traffic.

## Why this exists alongside the AWS stack, not instead of it

The cutover is reversible by construction. `apps/web/lib/host.ts` and
`apps/web/lib/kms.ts` dispatch on `CLOUD_PROVIDER` at call time, and
`decryptSecret` dispatches on each stored envelope's own version prefix
rather than on the current provider. So a credential wrapped by AWS KMS stays
readable after the switch to Azure, and one wrapped by Key Vault stays
readable after a rollback. Flipping the variable moves the runtime; flipping
it back moves it home. Nothing has to be migrated first.

## What is different from the AWS stack

Most of it maps one to one: VNet for VPC, Key Vault for KMS, Blob Storage for
S3, Azure Monitor for CloudWatch, a static Public IP for the Elastic IP. Three
things genuinely differ.

**There is no API Gateway or Lambda proxy.** On AWS, `apps/web` signs requests
with SigV4 to API Gateway, which forwards to a Lambda, which reaches the host
over a security-group-restricted path. That proxy has a hard, non-configurable
29-second timeout, and an authenticated Codex turn can run for 900 seconds —
which is the entire reason `ORCHESTRATOR_DIRECT_URL` exists on the AWS side as
a bypass. Azure uses that direct path as the only path: `apps/web` calls Caddy
on the host over TLS with the shared secret. One fewer tier, and the timeout is
gone rather than worked around.

**The host has to deallocate itself.** An EC2 instance carries
`InstanceInitiatedShutdownBehavior: stop`, so the orchestrator's idle timer
running `systemctl poweroff` stops the instance and stops the bill. An Azure VM
shut down from inside the guest stays _allocated_ and keeps charging for its
cores. The orchestrator therefore calls `/usr/local/sbin/codev-host-poweroff`,
which the bootstrap installs per cloud, and the VM's managed identity holds
Virtual Machine Contributor scoped to itself so it can ask ARM to deallocate.
Getting this wrong produces a host that looks off and costs full price.

**The VM size is load-bearing.** Firecracker needs `/dev/kvm`. The default
`Standard_D2s_v7` was verified to expose `vmx` with `kvm_intel` loaded and to
run Firecracker v1.13.2. Not every size does, and a size without nested
virtualization provisions perfectly and then cannot start a single microVM.
Note also that 850 of 1,333 sizes are restricted on this subscription,
including the whole x86 B-family, so there is no cheap burstable tier here.

## One bootstrap, two clouds

`infra/aws/scripts/bootstrap-host.sh` serves both. Roughly 600 of its lines —
Firecracker, the jailer, XFS reflinks, network isolation, Caddy, Orca — are
cloud-agnostic, and only four operations differ: fetching an artifact, reading
this host's public IP, reading the direct secret, and syncing Caddy's
certificates. Those four sit behind shim functions selected by `CODEV_CLOUD`,
which defaults to `aws`. Forking a second copy would have guaranteed drift in
the 600 lines to save changing four.

The script keeps its `infra/aws/` path because moving it would touch
`deploy.sh`, `package.json`, a contents-asserting test, and the workflow path
filters — all on the live AWS deploy path, for a rename.

## Changing cloud-init means replacing the VM

`osProfile.customData` is immutable on an existing Azure VM — a deployment
carrying a different value is rejected with `PropertyChangeNotAllowed`, where
EC2 UserData can simply be updated in place. So any edit to the cloud-init
block in `main.bicep` requires deleting the host first:

```bash
az vm delete -g <rg> -n codev-runtime-host --yes
az disk list -g <rg> --query "[].name" -o tsv | xargs -I{} az disk delete -g <rg> -n {} --yes
./infra/azure/deploy.sh
```

This is why cloud-init here does as little as possible and carries nothing
that varies between deploys. The release version travels as a VM tag instead,
read back through IMDS, so rolling a new release forward is just a tag update
and a restart. Treat cloud-init as the bootstrap-of-the-bootstrap: if a change
can go in `bootstrap-host.sh`, put it there, because that one ships as a blob
and needs no replacement.

Note that the public IP, Key Vault, storage account and the user-assigned
identity all survive a host replacement, so it costs a few minutes rather
than a reconfiguration.

## Deploying

```bash
AZURE_RESOURCE_GROUP=codev-runtime-migration ./infra/azure/deploy.sh
```

In CI this runs from
[`.github/workflows/deploy-runtime-azure.yml`](../../.github/workflows/deploy-runtime-azure.yml)
on pushes to `main`, authenticating through OIDC. There is no Azure client
secret in the repository: the app registration trusts GitHub's token through a
federated credential matched on repo and ref.

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

## Retiring the AWS key

Once both runtimes have been live, credentials exist in both envelope formats.
Everything keeps working, but the KMS key cannot be deleted while anything is
still sealed under it. To re-wrap:

```bash
CLOUD_PROVIDER=azure \
CREDENTIAL_KMS_KEY_ID=... \
CREDENTIAL_KEY_VAULT_KEY_ID=... \
pnpm rewrap:credentials --commit
```

It defaults to a dry run and reports what it would change. Shared-chat invite
tokens are deliberately skipped: they expire within their TTL, so re-wrapping
them preserves values that are worthless within hours.
