# Superset agent isolation: next steps

**Status:** Planned after the implemented baseline  
**Date:** 2026-10-04

The teammate-isolation baseline is implemented. These steps deliberately put
production proof ahead of additional containment: an unverified sandbox is not
a security boundary.

## 1. Deploy and prove the checkpoint path

- Set `CODEV_CONTROL_PLANE_URL` for the Azure deployment and copy the emitted
  `CODEV_CONTROL_PLANE_SECRET` into the web environment.
- Run an authenticated Codex agent, allow it to refresh credentials, then
  trigger idle hibernation and resume the workspace.
- Verify: the run is cancelled cleanly, its seat is released, its profile is
  gone before the snapshot, the refreshed credential is usable after resume,
  and a failed callback prevents hibernation.

## 2. Validate the guest hardening on the real image

- Confirm `hidepid=2`, Yama ptrace scope 2, profile permissions, and the
  `nosuid,nodev` workspace mount after boot and resume.
- Confirm the owner terminal and agent UID cannot read another launch profile.
- Run Rust formatting/tests on a Linux environment with Cargo, including the
  hibernation callback path.

## 3. Evaluate user namespaces or bubblewrap

- Prototype one provider command with its credential profile available only to
  the CLI and not general tool subprocesses where provider support permits.
- Test Git, package installation, file watching, PTY input, and Yjs updates.
- Adopt it only if it preserves the shared `/workspace` contract and has a
  clear cleanup/recovery path. Otherwise retain per-launch UID isolation and
  document the residual trusted-teammate risk.

## 4. Add egress controls only with a workable boundary

- Measure which provider, Git, package-registry, and system endpoints the
  live image needs.
- Choose either a guest egress proxy or per-sandbox network namespace policy.
- Treat Git and registries as possible upload channels; an allowlist reduces
  accidental exposure but does not make untrusted workspace code safe.

## 5. Optional collaborator terminal grants

- Keep owner-only as the default.
- If product needs grants, give each grantee a distinct guest UID/profile and
  revoke their terminals during membership removal. Do not reuse `codev-shell`.

## Explicitly out of scope

Per-agent Firecracker VMs with NFS/vsock sharing and owner-funded API-key
gateway mode remain separate product projects, not extensions of this rollout.
