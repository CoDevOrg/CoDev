# ARM workspace free tier — Phase 1 review

**Date:** 2026-10-04. **Scope:** standalone ARM workspace image and isolated workload proof.
**Status:** image, lifecycle, compatibility, and security checks pass. Phase 1 remains blocked on the real Claude turn: the connected account has insufficient credits. **Phase 2 is not ready.**

See the [Phase 0 decisions and $6.50 workspace budget](./arm-workspace-free-tier-phase-0.md).
Production runtime and web deployments were not changed. Commits use `[skip ci]` to suppress existing automatic production workflows; the ARM image workflow is dispatched manually.

## Decisions

- Use Ubuntu 24.04 ARM64 on an unzoned `Standard_D2ps_v6`, one VM per workspace. Dpsv6 lacks nested virtualization, so the ARM image runs guestd and Superset directly. The existing x86 Firecracker gallery and runtime remain separate.
- Pin the base to `Canonical:ubuntu-24_04-lts:server-arm64:24.04.202609040`. The source and captured OS disk are **30 GiB StandardSSD_LRS**, within the modeled E4 tier; the durable workspace disk is **16 GiB StandardSSD_LRS at LUN 0**.
- Build native runtime artifacts on GitHub's ARM64 Linux runner, sign all four artifacts with keyless Sigstore, upload immutable release blobs to private storage, and verify exact-workflow provenance inside an isolated native Azure builder before publishing an immutable gallery version.
- Use a native `Standard_D4ps_v6` builder. Azure Image Builder failed twice before allocating a VM. Native provisioning uses credential-free Azure Run Command; generalization uses host-key-pinned SSH restricted temporarily to the runner's IP. Run Command cannot report completion after `waagent` removes its own state.
- Keep guestd on `127.0.0.1:5252` and Superset on `127.0.0.1:4879`. Loopback alone permits hostile terminal callers. A required firewall permits privileged RPC only to root and UID 1000 (the image builder); terminal UID 2000 and isolated agent UIDs are denied. A generalized VM's administrator may have a different UID and uses sudo for maintenance RPC.
- Exercise provider launch through the existing `/v1/superset-agents` launch-profile contract over a pinned SSH privileged relay. Provider credentials stay in the local caller's memory and private per-process VM profiles, never in Azure Run Command, image source, metadata, shell arguments, or GitHub logs.
- Do not add a tunnel, public runtime endpoint, ARM product provisioner, production deployment, or Phase 2 integration. Public transport still requires authenticated workspace/generation capabilities.

## Published artifacts and build evidence

| Candidate | Source / release             | Evidence                                                                                                                                                                                 | Approval                                                           |
| --------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `1.0.6`   | `16d251b43`, `2026.10.04.7`  | [Successful run 37186831592](https://github.com/CoDevOrg/CoDev/actions/runs/37186831592), in-VM signatures, CLI versions, bridge/Superset health, complete West US 2 gallery replication | Retired after final validation; lacked caller firewall             |
| `1.0.7`   | `54b2b977c`, `2026.10.04.9`  | [Successful run 37188307476](https://github.com/CoDevOrg/CoDev/actions/runs/37188307476), `CODEV_ARM_LOCAL_API_ISOLATION_VALIDATED`, `CODEV_ARM_IMAGE_VALIDATED`, complete replication   | Retired after final validation; lacked the architecture correction |
| `1.0.8`   | `2bd2f2515`, `2026.10.04.11` | [Final run 37189209416](https://github.com/CoDevOrg/CoDev/actions/runs/37189209416)                                                                                                      | VM checks pass; quarantined pending Claude credits                 |

Gallery: `codevarmworkspacegallery`; definition: `codev-workspace-arm64`; resource group: `codev-arm-workspace-phase1`; private artifact account: `codevarm8ad43e43af644d36`. Final version `1.0.8` is excluded from latest and tagged `Phase1Status=BlockedClaudeCredit`; production does not select it. Intermediate `1.0.6` / `1.0.7` versions were removed after final validation. Their workflow logs remain the build history.

Each release contains `superset-host-linux-arm64.tar.gz`, `codev-guestd-linux-arm64`, `verify-superset-host-artifact.mjs`, and `runtime-manifest.json`, with SHA-256 files and Sigstore bundles. The verifier requires identity `https://github.com/CoDevOrg/CoDev/.github/workflows/build-arm-workspace-image-azure.yml@refs/heads/main` and issuer `https://token.actions.githubusercontent.com`. Cosign 3.1.3 is pinned to SHA-256 `c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a`. Failed verification prevents installation/publication.

Installed versions: Node 24, pnpm 11.5.0, Codex 0.148.0, Claude Code 2.1.236, Superset 1.30.2; runtime compilation uses Bun 1.3.14 and Rust 1.97.1. The native Superset artifact includes 46 native runtime packages and passes its native-module, host-service, and PTY checks.

Azure OIDC and scoped RBAC are verified. The Actions app has Contributor and Role Based Access Control Administrator on the candidate resource group and Storage Blob Data Contributor on the artifact account. The configured environment is `arm-workspace`; its OIDC subject is `repo:CoDevOrg@320302482/CoDev@1315384847:environment:arm-workspace`. The manager's permissions are no longer a blocker.

## Isolated VM workload evidence

Initial workload proof used candidate `1.0.6` with the corrected firewall installed and enabled **before** agent credentials were supplied. The final `1.0.8` image then repeated the workload, native dependencies, full repository typecheck, security, reboot, and deallocated-start checks on the saved disk; a separate fresh VM verified new-disk initialization and blank/public/private repository paths. Tests use a new, task-owned 16 GiB disk; only its first boot formats it after confirming the exact size and absence of an existing filesystem. Reboots and replacements do not format or initialize it.

| Check                     | Observed result                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Boot and mount            | Unzoned `Standard_D2ps_v6`, ext4 at `/workspace`, both services healthy and bound only to loopback                                                                                                                                                                                                                                                                                   |
| Local caller firewall     | Real Azure kernel: root and builder UID 1000 allowed; UID 2000 and isolated UID 25000 rejected; applying guard twice succeeds                                                                                                                                                                                                                                                        |
| Terminal                  | Superset PTY input/poll/close succeeds and reports UID 2000; terminal cannot read bridge secrets or list provider profiles                                                                                                                                                                                                                                                           |
| Files and uploads         | Existing UTF-8 write contract creates `.codev/uploads/phase1-upload.md`; Superset creates, edits, and reads a file with revision checking                                                                                                                                                                                                                                            |
| Git and worktrees         | Blank repository initialization/commit, Git status, managed worktree, registered direct-child `/workspace` worktree, file browsing all pass                                                                                                                                                                                                                                          |
| Public repository         | Anonymous CoDev clone; frozen pnpm installation and full repository typecheck pass on ARM64                                                                                                                                                                                                                                                                                          |
| Private repository        | Authenticated GitHub fetch occurs on the control side. Credential-free bounded snapshot contains six files / 23,676 bytes; VM materialization and Git initialization pass. A separately imported Git bundle passes `git fsck`. No GitHub token is sent to the VM                                                                                                                     |
| Codex                     | Actual authenticated turn through Superset returns `ARM_PROVIDER_OK`, exits 0 in 12.4 seconds on final `1.0.8` (16.3 seconds on the intermediate); private profile is removed on exit                                                                                                                                                                                                |
| Claude                    | Both the local minimal turn and real Superset turn on final `1.0.8` return **“Credit balance is too low”**. ARM launch and private-profile isolation pass; the provider response gate remains blocked                                                                                                                                                                                |
| Disk occupancy            | ext4 capacity 16,729,894,912 bytes. After full CoDev install, native fixture, worktrees, and private checkout: 2,752,167,936 bytes used / 13,101,957,120 bytes available. CoDev checkout including dependencies: 2.0 GiB; shared pnpm store: 114 MiB                                                                                                                                 |
| Reboot                    | Final `1.0.8`: both services return in **92.0 seconds** (intermediate: 92.7), including Azure restart request and SSH readiness polling. Saved markers, eight Git HEADs, worktrees, and filesystem UUID are unchanged                                                                                                                                                                |
| Deallocated cold start    | Final `1.0.8`: both services return in **81.8 seconds** (intermediate: 81.9), including Azure start request and SSH polling; all saved state remains unchanged                                                                                                                                                                                                                       |
| Fresh VM / OS replacement | New final-image VM reaches Azure provisioning completion in **29.6 seconds**; healthy runtime is observed through trusted Azure Run Command by **122.6 seconds**, including command transport/polling. Saved files, six original Git HEADs, original worktrees, and filesystem UUID match; two additional worktrees are then created intentionally and preserved across reboot/start |
| ENOSPC and recovery       | Final image: bounded allocation leaves little usable space, unprivileged write returns `No space left on device`, removing test files restores successful writes, and both services remain healthy. A transient first attempt was rerun after compilation finished; only the successful settled run is acceptance evidence                                                           |

This is a control-side workload harness, not a deployed ARM product integration. It exercises the existing launch/file/Superset contracts and GitHub snapshot data shape without starting the web application or sending credentials through Azure scripts. Private repository identity/content and credential payloads are intentionally absent from this public review.

Fresh-disk test on final `1.0.8`: a second, explicitly new 16 GiB disk was formatted once; blank repository initialization, public clone, private bounded-snapshot materialization, file/upload/Git/worktree/terminal checks pass. Azure VM creation completed in 28.5 seconds; initialized runtime health was observed by 61.3 seconds including trusted command transport. No failed systemd units remained.

On the final image, live Codex and Claude profiles had mode 0700, isolated owners with UID ≥100,000, and credential-file mode 0600 when present. UID 2000 could not read their known paths. Bridge secrets remained root-owned 0600 and the profile parent root-owned 0711. After both agents ended, no launch profiles remained. A scan of 87 files across `/var/log`, `/var/lib/codev`, root Azure/Codex/Claude configuration paths, and `/etc/codev` found **zero matches** for either provider's token values. VM creation metadata contains no provider payload or managed identity. This is a scoped scan plus construction evidence, not a claim to prove every possible leak channel.

## ARM compatibility

| Dependency                | Tested version                 | Result                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| esbuild                   | 0.28.2                         | TypeScript transform passes                                                                                                                                                                                                                                                                |
| sharp                     | 0.35.5                         | Native 2×2 PNG generation passes                                                                                                                                                                                                                                                           |
| better-sqlite3            | 13.0.3                         | Native build with Node 24; SQL result verified                                                                                                                                                                                                                                             |
| node-pty                  | 1.1.0                          | Native build; PTY output verified                                                                                                                                                                                                                                                          |
| @parcel/watcher           | 2.6.0                          | Subscription/unsubscription passes                                                                                                                                                                                                                                                         |
| Full CoDev pnpm workspace | Frozen repository lockfile     | Install and typecheck pass on the 16 GiB disk                                                                                                                                                                                                                                              |
| Linux x86-64-only ELF     | Minimal static test executable | Live test exposed portable-pty's shell fallback, which hid ENOEXEC. Final runtime checks ELF architecture before spawning and returns exit 127 / `Unsupported executable architecture` with rebuild guidance; final `1.0.8` direct-execution test passes and runtime health remains normal |

Build-essential, Python, and pkg-config are installed for dependencies without ARM64 prebuilt binaries. Rebuild compatible native modules from source; packages that only ship x86-64 executables remain unsupported. These samples establish a compatibility list, not universal project compatibility.

## Validation

- `pnpm typecheck`: pass.
- `pnpm lint`: pass with 11 existing warnings across packages; no new lint warnings.
- `pnpm test`: 956 tests pass.
- Native Linux ARM64 Rust tests in Apple `container`, Rust 1.97.1: 71 library tests and two guestd tests pass. The container requires adequate memory; a default-memory link attempt was killed, then passed with 4 GiB / two compile jobs.
- Bash syntax and Bicep compilation pass; scoped diff checks pass. The CI build includes loopback, architecture-error, and ELF preflight tests.
- Git trust is configured during image provisioning, before the service's read-only system sandbox. A live reboot exposed and corrected the previous `/etc/gitconfig` write attempt inside `ExecStartPre`.

## Acceptance criteria

All six gates are required. A published image alone is insufficient.

| Gate                                        | Status                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Repeatable native build                  | PASS — final workflow and two prior successful builds                             |
| 2. In-VM artifact provenance                | PASS — exact-workflow signatures and checksums required before install            |
| 3. Immutable isolated publication / cleanup | PASS — final version pinned, excluded from latest, no production change           |
| 4. Fresh/saved disk and lifecycle           | PASS — final image, 16 GiB disks, reboot/start/replacement/capacity evidence      |
| 5. Workloads and private credentials        | **BLOCKED** — all runtime/security checks and Codex pass; Claude requires credits |
| 6. ARM compatibility and explicit failure   | PASS — native dependencies, full repo typecheck, live x86-only negative test      |

1. **Repeatable build:** manual workflow completes on `main` using native ARM64; its runtime and CLI validation/tests pass.
2. **Provenance:** every artifact's checksum and Sigstore bundle match the exact repository/workflow/ref/issuer; validation occurs inside the VM before extraction/execution.
3. **Isolation:** immutable final gallery version uses the pinned Ubuntu source; builder/network cleanup completes; no production gallery/runtime is changed.
4. **Lifecycle:** final candidate boots an unzoned D2psv6 with a 30 GiB E4 OS disk and new 16 GiB E3 workspace disk, both services healthy. Reboot, deallocate/start, and replacement OS/VM preserve saved files, Git state, worktrees, and filesystem UUID without reformatting. Record times and capacity/recovery results.
5. **Workload/security:** terminal/files/uploads/Git/worktrees/Superset plus **both real authenticated Codex and Claude turns** pass on the final candidate. Terminal/agent processes cannot reach privileged RPC or read other profiles; profile permissions/cleanup pass, and credential scans find no copied secrets in image files, logs, or metadata.
6. **Compatibility:** native dependency fixture and full repository installation/typecheck pass; direct x86-only execution produces the explicit unsupported-architecture result without degrading runtime health.

## Unresolved risks and handoff

- **Blocking Phase 1:** a funded/usable Claude connection is required. The user has been asked to fund the current account or sign the local CLI into a usable account. Re-run the actual isolated Superset turn afterwards; do not substitute an unauthenticated CLI/version check.
- **Claude retest:** create another isolated final-image smoke VM after the connection is usable, send credentials only through the trusted launch-profile path, require `ARM_PROVIDER_OK` and exit 0, verify profile cleanup, and tear the VM down. Only then clear the quarantine tag and mark Phase 1 complete; no production promotion is implied.
- **Cold-start SLO:** the Phase 0 later integration target remains 20 starts, at least 19 authenticated bridge successes, p50 ≤60 seconds / p95 ≤120 seconds. The current isolated measurements exclude public tunnel registration and browser-to-control-plane latency, and are not an SLO sample. Recursive chmod/chgrp on large checkouts can dominate boot; address it before runtime rollout.
- **Superset metadata:** host SQLite state is currently on the OS disk under `/var/lib/codev/codev-superset`. Workspace files/Git survive a replacement OS, but Superset session metadata does not have that durability guarantee. Phase 2 must define persistence/migration before enabling members.
- **Public authentication:** the privileged local bridge must not be exposed through Cloudflare Tunnel until workspace/generation capabilities and revocation are implemented.
- **Project size:** 16 GiB fits the measured checkout/install, but larger builds, additional worktrees, caches, or container images can exceed it. Record the tested workload and retain clear disk-full recovery behavior.
- **Budget:** the measured 30 GiB OS disk confirms E4 sizing. The $6.50 model still depends on active-only compute/IP lifecycle, disk operations, bandwidth, tax, and reserved variable-cost headroom from Phase 0; admin unlimited product minutes do not make Azure usage free.

## Cleanup and current state

Temporary builder and smoke VMs, their OS disks, test data disks, SSH IP/NIC/VNet/NSG, obsolete Image Builder templates, and unsafe intermediate gallery versions are removed. The final excluded gallery image, signed private release artifacts, gallery/definition, and scoped builder identity remain for review. No production runtime or web deployment was changed. Local ephemeral SSH keys and private repository fixture copies are removed after teardown.

**Phase 1 is not complete because gate 5 is blocked by Claude credits. Phase 2 is not ready to start.** Azure permissions and the image/runtime checks are complete. The required user action is to fund the current Claude account or sign the local CLI into a usable account, then repeat its real isolated turn.
