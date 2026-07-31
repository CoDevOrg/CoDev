# CoDev AWS Firecracker Runtime

Phase 3 deploys one ARM bare-metal Firecracker host in `us-east-2`. Vercel
reaches it through an IAM-authorized API Gateway HTTP API and a usage-based
Lambda proxy attached to the runtime VPC. The host has no public inbound rules
and is administered through AWS Systems Manager.

Phase 8 adds 14-day API Gateway, Lambda, and structured Rust host log
retention, request-ID propagation, CloudWatch alarms for API/Lambda/EC2
failures, and a compact `codev-runtime-*` dashboard. See
[Operations](../../docs/OPERATIONS.md) for incident and rollback procedures.
Phase 9 adds a tagged monthly AWS Cost Budget. Set
`CODEV_BUDGET_ALERT_EMAIL` during deployment to receive forecasted alerts at
80% and actual-spend alerts at 100%; the recipient must confirm AWS's
subscription email.

Current production endpoint:
`https://y0h0aur7sc.execute-api.us-east-2.amazonaws.com`.

The deployment deliberately uses IAM roles instead of creating another IAM
user or access key:

- `codev-firecracker-host` lets the EC2 host read versioned runtime artifacts
  and register with Systems Manager.
- `codev-vercel-production` trusts only the CoDev production OIDC subject.
- `codev-vercel-preview` trusts only the CoDev preview OIDC subject.
- Both Vercel roles can invoke only the CoDev API Gateway API, describe EC2
  state, and start the exact Firecracker host.

## Deploy

From the repository root:

```sh
infra/aws/deploy.sh
```

Defaults:

- AWS account: current CLI identity
- Region: `us-east-2`
- Availability Zone: `us-east-2a`
- Host: `a1.metal`
- Host image: `ami-0713df58d0d8b3c1c` (Ubuntu 24.04 ARM64 with a generic kernel)
- Host root volume: 40 GiB encrypted gp3
- Snapshot jailer volume: 40 GiB encrypted gp3 by default
- Firecracker: `v1.13.2`
- Maximum concurrent microVMs: 2
- Per microVM: 2 vCPU, 2 GiB memory, 10 GiB sparse disk
- Snapshot jailer storage: a dedicated XFS gp3 volume with reflinks enabled;
  Firecracker writable disks are cloned with metadata-only copy-on-write so
  restore does not copy multi-GiB images
- Workspace idle timeout: 4 hours before automatic Firecracker hibernation
- Host shutdown: 15 minutes after the final microVM stops
- Monthly cost budget: $75 by default (`CODEV_MONTHLY_BUDGET_USD`)

The script cross-compiles both statically linked Rust binaries for Linux ARM64, uploads an immutable release
plus the lifecycle smoke-test script to private S3, deploys the CloudFormation stacks, and creates or updates the
Vercel OIDC roles. It prints the API URL and role ARNs needed by Vercel.
Each release creates a new launch-template version, which makes CloudFormation
replace the host instead of merely updating EC2 user data that would not rerun.

Set `CODEV_HOST_AMI_ID` when deploying into another account or region because
the default AMI is account- and region-specific.
Set `CODEV_JAILER_VOLUME_SIZE_GIB` to change the dedicated reflink-enabled
snapshot volume size.

## Lifecycle validation

The repository ships `/opt/codev-verify-lifecycle.sh` for the current
snapshot/restore path. It must be run on the deployed Linux/KVM host after a
release change; this Mac workspace cannot validate `/dev/kvm` or EC2 power
transitions directly.

## Access and diagnostics

No SSH key or inbound SSH rule is created. Use Systems Manager:

```sh
aws ssm start-session --target INSTANCE_ID --region us-east-2
```

Host logs:

```sh
sudo journalctl -u codev-orchestrator -f
```

After deploying a Rust or Firecracker change, validate the real pause/restore
path on the host:

```sh
sudo /opt/codev-verify-lifecycle.sh
```

The script requires a running local orchestrator, verifies dirty-file
preservation across a Firecracker snapshot and restore, enforces the 500 ms
restore target, and confirms zero active sandboxes after destruction.

The encrypted 40 GiB host volume and all workspace disks are deleted with the
instance when the runtime stack is deleted. The artifact bucket is retained so
that stack deletion cannot silently remove release evidence.

The `a1.metal` host costs approximately `$0.408/hour` only while running. CoDev
wakes it before provisioning a sandbox, and the orchestrator initiates an EC2
stop after 15 idle minutes. The retained 40 GiB gp3 volume costs approximately
`$3.20/month`; snapshot, Lambda, API Gateway, public IPv4 while running, and
artifact storage are additional usage-based charges.
