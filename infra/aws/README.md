# CoDev AWS Firecracker Runtime

Phase 3 deploys one ARM bare-metal Firecracker host in `us-east-2`. Vercel
reaches it through an IAM-authorized API Gateway HTTP API and a usage-based
Lambda proxy attached to the runtime VPC. The sandbox control API has no
public inbound rules and is administered through AWS Systems Manager.

The same host also runs one dedicated `orca serve` process per workspace —
the Orca IDE backend, built by CoDev from source (see
[Orca IDE runtime](#orca-ide-runtime) below) rather than trusted as a
prebuilt third-party binary — fronted by Caddy on public 80/443. Browsers
connect to Caddy directly for that WebSocket protocol; it does not go
through the SigV4-authenticated API Gateway/Lambda path above.

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
Set `CODEV_SKIP_ORCA_BUILD=1` to skip the ~15-30 minute from-source Orca
build for an orchestrator-only redeploy, reusing whatever
`orca-serve-linux-arm64.tar.gz` already exists at the target release
version in S3.

## Orca IDE runtime

`orca serve` (Orca's Electron main process / IDE backend) is built by CoDev
from `stablyai/orca`'s real MIT source at a pinned tag —
[`infra/aws/orca-build/Containerfile`](orca-build/Containerfile), run via
Apple's `container` tool by
[`infra/aws/scripts/build-orca-serve.sh`](scripts/build-orca-serve.sh) —
instead of downloading upstream's prebuilt `orca-linux-arm64.AppImage`
release asset. `deploy.sh` uploads the resulting
`orca-serve-linux-arm64.tar.gz` alongside the orchestrator/guestd binaries;
`bootstrap-host.sh` fetches, checksum-verifies, and extracts it to
`/opt/orca/squashfs-root`.

`codev-orchestrator` spawns, tracks, and reaps one `orca serve` process per
_workspace_ (not one shared instance) via
`POST/GET/DELETE /v1/sandboxes/{workspaceId}/ide`
([`services/orchestrator/src/backend/orca.rs`](../../services/orchestrator/src/backend/orca.rs)).
Each session gets its own dedicated Linux user (Orca's packaged build
resolves `userData`/its Electron single-instance lock to one fixed path per
OS user, so this is the only way to run more than one session on the host at
once), its own loopback port, and its own clone directory under
`/srv/codev/workspaces/<workspaceId>` — which the orchestrator also clones
into directly now, replacing the SSM-based clone script this replaced. On
every start/stop, the orchestrator posts a full config replacement to
Caddy's local admin API (`127.0.0.1:2019`) adding/removing that workspace's
`handle_path /w/<workspaceId>/*` route, so one public Caddy TLS endpoint
path-routes to every active session. `CODEV_MAX_IDE_SESSIONS` and
`CODEV_IDE_IDLE_TIMEOUT` cap concurrency and idle lifetime, mirroring
`CODEV_MAX_SANDBOXES`/`CODEV_IDLE_TIMEOUT` for Firecracker sandboxes.

The public hostname is a `nip.io` name derived from the host's current
public IPv4 at boot (no real domain/DNS record needed); Caddy obtains its
own Let's Encrypt certificate for it. Vercel's `apps/web/lib/orca-host.ts`
and `apps/web/lib/orca-pairing.ts` talk to the `/ide` routes with the same
SigV4-signed API Gateway path as the sandbox control API — SSM RunCommand is
not used for Orca at all.

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
sudo journalctl -u caddy -f
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
