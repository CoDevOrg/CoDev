# CoDev AWS Firecracker Runtime

Phase 3 deploys one ARM bare-metal Firecracker host in `us-east-2`. Vercel
reaches it through an IAM-authorized API Gateway HTTP API and a usage-based
Lambda proxy attached to the runtime VPC. The host has no public inbound rules
and is administered through AWS Systems Manager.

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
- Firecracker: `v1.13.2`
- Maximum concurrent microVMs: 2
- Per microVM: 2 vCPU, 2 GiB memory, 10 GiB sparse disk
- Idle timeout: 30 minutes
- Hard workspace expiry: 4 hours
- Host shutdown: 15 minutes after the final microVM stops

The script builds both Go binaries for Linux ARM64, uploads an immutable release
to private S3, deploys the CloudFormation stacks, and creates or updates the
Vercel OIDC roles. It prints the API URL and role ARNs needed by Vercel.

Set `CODEV_HOST_AMI_ID` when deploying into another account or region because
the default AMI is account- and region-specific.

## Verified lifecycle

The Phase 3 delivery was exercised from a clean host on July 29, 2026. A real
Firecracker guest cloned CoDev, returned the checked-out Git revision, read
`README.md`, reported Git status, executed `uname` through its PTY API, and was
then destroyed with no workspace runtime directory left behind. Two concurrent
guests were also created to verify the host limit.

## Access and diagnostics

No SSH key or inbound SSH rule is created. Use Systems Manager:

```sh
aws ssm start-session --target INSTANCE_ID --region us-east-2
```

Host logs:

```sh
sudo journalctl -u codev-orchestrator -f
```

The encrypted 40 GiB host volume and all workspace disks are deleted with the
instance when the runtime stack is deleted. The artifact bucket is retained so
that stack deletion cannot silently remove release evidence.

The `a1.metal` host costs approximately `$0.408/hour` only while running. CoDev
wakes it before provisioning a sandbox, and the orchestrator initiates an EC2
stop after 15 idle minutes. The retained 40 GiB gp3 volume costs approximately
`$3.20/month`; snapshot, Lambda, API Gateway, public IPv4 while running, and
artifact storage are additional usage-based charges.
