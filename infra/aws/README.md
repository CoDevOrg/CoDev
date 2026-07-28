# CoDev AWS Firecracker Runtime

Phase 3 deploys one ARM bare-metal Firecracker host in `us-east-2`. Vercel
reaches it through an IAM-authorized API Gateway HTTP API, a private VPC link,
and an internal Network Load Balancer. The host has no public inbound rules and
is administered through AWS Systems Manager.

The deployment deliberately uses IAM roles instead of creating another IAM
user or access key:

- `codev-firecracker-host` lets the EC2 host read versioned runtime artifacts
  and register with Systems Manager.
- `codev-vercel-production` trusts only the CoDev production OIDC subject.
- `codev-vercel-preview` trusts only the CoDev preview OIDC subject.
- Both Vercel roles can invoke only the CoDev API Gateway API.

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
- Maximum concurrent microVMs: 2
- Per microVM: 2 vCPU, 2 GiB memory, 10 GiB sparse disk
- Idle timeout: 30 minutes
- Hard workspace expiry: 4 hours

The script builds both Go binaries for Linux ARM64, uploads an immutable release
to private S3, deploys the CloudFormation stacks, and creates or updates the
Vercel OIDC roles. It prints the API URL and role ARNs needed by Vercel.

## Access and diagnostics

No SSH key or inbound SSH rule is created. Use Systems Manager:

```sh
aws ssm start-session --target INSTANCE_ID --region us-east-2
```

Host logs:

```sh
sudo journalctl -u codev-orchestrator -f
```

The encrypted 200 GiB host volume and all workspace disks are deleted with the
instance when the runtime stack is deleted. The artifact bucket is retained so
that stack deletion cannot silently remove release evidence.
