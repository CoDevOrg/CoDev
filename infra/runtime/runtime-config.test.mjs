import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * The slice of `source` between two markers, both of which must be present.
 *
 * Several tests below assert against one region of a script rather than the
 * whole file. Reaching for `indexOf` directly is a trap: a marker that gets
 * renamed returns -1, `slice` reads that as "one from the end", and the test
 * silently widens to almost the entire file instead of failing. That is not
 * hypothetical -- it happened to the stage-helper test here, which then fed
 * most of bootstrap-host.sh to a real `bash` and hung on its `az login` retry
 * loop. Prefer function signatures as markers over comment text, and fail
 * loudly when one is gone.
 */
const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marker not found after start: ${endMarker}`);
  return source.slice(start, end);
};

const bootstrap = read("./scripts/bootstrap-host.sh");
const buildOrca = read("./scripts/build-orca-serve.sh");
const buildOrcaWeb = read("./scripts/build-orca-web.sh");
const imageProvision = read("./scripts/provision-host-image.sh");
const azureTemplate = read("../azure/main.bicep");
const azureDeploy = read("../azure/deploy.sh");
const azureImageBuilder = read("../azure/image-builder.bicep");
const azureImageBuild = read("../azure/build-host-image.sh");

// Firecracker needs /dev/kvm, and not every Azure size exposes it: a size
// without nested virtualization provisions perfectly and then cannot start a
// single microVM. The Dsv7 Intel series supports nested virtualization and
// D8s_v7 is the current six-sandbox default.
test("defaults the Firecracker host to a six-sandbox nested-KVM size", () => {
  assert.match(azureTemplate, /param hostVmSize string = 'Standard_D8s_v7'/);
  assert.match(azureDeploy, /CODEV_AZURE_VM_SIZE:-Standard_D8s_v7/);
  assert.match(bootstrap, /CODEV_MAX_SANDBOXES=6/);
  // On-demand only. A Spot VM that loses its pool refuses to start again,
  // which strands a workspace whose only way back is starting the host.
  assert.doesNotMatch(azureTemplate, /priority:\s*'Spot'/);
});

test("hibernates idle sandboxes after fifteen minutes and quickly deallocates the host", () => {
  assert.match(bootstrap, /CODEV_IDLE_TIMEOUT=15m/);
  assert.match(bootstrap, /CODEV_HOST_IDLE_TIMEOUT=1m/);
  assert.match(bootstrap, /CODEV_IDE_IDLE_TIMEOUT=10m/);
  const orchestrator = read(
    "../../services/orchestrator/src/bin/orchestrator.rs",
  );
  const orca = read("../../services/orchestrator/src/backend/orca.rs");
  assert.match(orca, /has_recent_activity/);
  assert.match(orchestrator, /ide\s*\.has_recent_activity\(\)\.await/);
  // An Orca-only workspace never provisions a sandbox, so the host's idle
  // check has to consult the IDE backend or it powers off mid-session - and
  // it has to measure last *use*, not session existence, or an abandoned
  // session buys the host a second full idle window when the reaper clears
  // it.
  assert.match(orchestrator, /ide\s*\n?\s*\.last_activity_at\(\)/);
  assert.match(orchestrator, /\.map_or\(since, \|last\| last\.max\(since\)\)/);
});

test("builds and bootstraps architecture-specific runtime artifacts", () => {
  assert.match(azureDeploy, /x86_64-unknown-linux-musl/);
  assert.match(azureDeploy, /aarch64-unknown-linux-musl/);
  assert.match(bootstrap, /codev-orchestrator-linux-\$\{artifact_arch\}/);
  assert.match(bootstrap, /\n  gh\n/);
  assert.match(
    bootstrap,
    /firecracker-\$\{firecracker_version\}-\$\{firecracker_arch\}/,
  );
  assert.match(buildOrca, /TARGET_ARCH=\$\{electron_arch\}/);
  assert.match(buildOrcaWeb, /corepack pnpm@10\.24\.0/);
  assert.match(buildOrcaWeb, /rsync -a --delete/);
});

test("the golden host image is versioned, validated, and optional to promote", () => {
  assert.match(azureTemplate, /param hostImageId string = ''/);
  assert.match(azureTemplate, /imageReference: empty\(hostImageId\)/);
  assert.match(azureDeploy, /hostImageId="\$\{host_image_id\}"/);
  assert.match(
    azureImageBuilder,
    /Microsoft\.VirtualMachineImages\/imageTemplates@2023-07-01/,
  );
  assert.match(
    azureImageBuilder,
    /scriptUri: '\$\{artifactStorage\.properties\.primaryEndpoints\.blob\}/,
  );
  assert.match(azureImageBuilder, /sha256Checksum: provisionScriptSha256/);
  assert.match(azureImageBuilder, /type: 'SharedImage'/);
  assert.match(azureImageBuilder, /name: 'DiskControllerTypes'/);
  assert.match(azureImageBuilder, /value: 'SCSI,NVMe'/);
  assert.match(azureImageBuilder, /f1a07417-d97a-45cb-824c-7a7467783830/);
  assert.match(
    azureImageBuilder,
    /galleryImageId: '\$\{imageDefinition\.id\}\/versions\/\$\{imageVersion\}'/,
  );
  assert.match(azureImageBuilder, /inVMValidations:/);
  assert.match(
    azureTemplate,
    /var selectedCloudInitTemplate = empty\(hostImageId\)/,
  );
  assert.match(azureTemplate, /package_update: false/);
  assert.match(azureTemplate, /command -v az >\/dev\/null/);
  assert.match(azureImageBuild, /az resource invoke-action/);
  assert.match(azureImageBuild, /CODEV_HOST_IMAGE_ID=\$\{image_version_id\}/);
  assert.match(azureDeploy, /storageProfile\.imageReference\.id/);
  assert.match(azureDeploy, /Preserving the existing host image/);
  assert.match(azureDeploy, /az vm delete/);
  assert.match(azureDeploy, /deleteOption=Detach/);
  assert.match(imageProvision, /codev-orchestrator-linux-\$\{artifact_arch\}/);
  assert.match(imageProvision, /codev-guestd-linux-\$\{artifact_arch\}/);
  assert.match(imageProvision, /rootfs\.ext4/);
  assert.doesNotMatch(imageProvision, /CODEV_DIRECT_SECRET/);
  assert.doesNotMatch(imageProvision, /orchestrator-direct-secret/);
  assert.doesNotMatch(imageProvision, /git clone/);
  assert.doesNotMatch(imageProvision, /caddy-data/);
});

// The IDE is first-party (packages/ide), not a vendored upstream checkout, so
// both artifacts must build from the tree. A reintroduced clone would mean the
// shipped IDE no longer matches the source under review — and would silently
// drop every CoDev change, since there is no patch to re-apply any more.
test("IDE artifacts build from packages/ide, never from an upstream clone", () => {
  // Comments legitimately mention the retired clone (explaining what replaced
  // it), so assert against executable lines only.
  const code = (source) =>
    source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

  const containerfile = read("./orca-build/Containerfile");
  for (const source of [buildOrca, buildOrcaWeb, containerfile]) {
    assert.doesNotMatch(code(source), /git clone/);
    assert.doesNotMatch(code(source), /stablyai\/orca/);
  }
  assert.match(buildOrcaWeb, /source_dir="\$\{repo_root\}\/packages\/ide"/);
  assert.match(buildOrca, /build_context="\$\{repo_root\}\/packages\/ide"/);
  assert.match(containerfile, /^COPY \. \/build$/m);
});

// The Azure bootstrap is a systemd unit because cloud-init's runcmd fires on
// first boot only, and rolling a release works by restarting the host. That
// unit must not be wanted by multi-user.target while waiting on cloud-init:
// cloud-init.target is ordered after multi-user.target, so systemd sees a
// cycle, deletes the bootstrap's start job, and every boot after the first
// silently skips it. It looked fine on the first boot, where runcmd started
// it by hand, and only a real reboot showed the host never rolling forward.
test("Azure bootstrap unit re-runs on every boot without an ordering cycle", () => {
  const unit = between(
    azureTemplate,
    "path: /etc/systemd/system/codev-bootstrap.service",
    "runcmd:",
  );
  assert.match(unit, /WantedBy=cloud-init\.target/);
  assert.doesNotMatch(unit, /WantedBy=multi-user\.target/);
  assert.doesNotMatch(unit, /After=.*cloud-init\.target/);
  assert.match(unit, /After=[^\n]*cloud-final\.service/);
  assert.match(unit, /RemainAfterExit=yes/);
});

// An idle Azure host deallocates itself, and `az vm restart` refuses a
// deallocated VM. The roll path has to start an off host, not only restart a
// running one, or the routine deploy fails whenever nobody is using the
// runtime -- which is most of the time.
// The bootstrap re-runs on every boot, by which point the orchestrator from
// the previous run is already executing out of /usr/local/bin. Writing the
// new binary into that path fails with ETXTBSY and kills the bootstrap, so
// every artifact is fetched to a staging path and renamed into place.
test("bootstrap never writes a release artifact onto a running binary", () => {
  const fetch = between(bootstrap, "codev_fetch() {", "codev_fingerprint() {");
  assert.match(fetch, /staging="\$\{destination\}\.codev-fetch\.\$\$"/);
  assert.match(fetch, /--file "\$\{staging\}"/);
  assert.doesNotMatch(fetch, /--file "\$\{destination\}"/);
  assert.match(fetch, /mv -f "\$\{staging\}" "\$\{destination\}"/);
});

test("Azure release roll starts a deallocated host instead of failing", () => {
  assert.match(azureDeploy, /PowerState\/running/);
  assert.match(azureDeploy, /az vm start \\/);
  assert.match(azureDeploy, /az vm restart \\/);
  // The release travels as a mutable VM tag, never in immutable customData.
  assert.match(azureTemplate, /ReleaseVersion: releaseVersion/);
  assert.doesNotMatch(azureTemplate, /__RELEASE_VERSION__/);
});

// apps/web's health check calls /healthz. The bearer route on the host is the
// only way in, so it has to match /healthz as well as /v1/*. The Caddyfile
// block is written twice, in
// the bootstrap and in the orchestrator that later replaces it over the admin
// API, and the two must not drift.
test("the direct bearer route serves /healthz and both copies agree", () => {
  const orca = read("../../services/orchestrator/src/backend/orca.rs");
  assert.match(bootstrap, /path \/v1\/\* \/healthz/);
  assert.match(orca, /path \/v1\/\* \/healthz/);
  assert.equal(
    (bootstrap.match(/path \/v1\/\*/g) ?? []).length,
    1,
    "bootstrap should declare the direct matcher exactly once",
  );
});

// The bootstrap runs on every boot, not once, and the host boots far more
// often than it is deployed to -- it deallocates itself after one quiet
// minutes without a sandbox or recently used IDE session. Reinstalling apt
// packages, Node, the agent CLIs, Orca, Caddy,
// Firecracker and a 3 GB guest rootfs on each of those boots put minutes in
// front of whoever was opening a workspace, because the orchestrator only
// starts once all of it finishes. Each of those stages is now keyed on its own
// inputs and skipped when the key is unchanged.
test("every expensive bootstrap stage is skipped when already current", () => {
  for (const stage of [
    "packages",
    "node",
    "cursor",
    "orca",
    "caddy",
    "firecracker",
    "kernel",
    "rootfs",
  ]) {
    assert.match(
      bootstrap,
      new RegExp(`codev_stage_done ${stage} "\\$\\{${stage}_key\\}"`),
      `${stage} should run only when its key changed`,
    );
    // Recorded after the work, never before: `set -e` aborts the script on a
    // failure, and a stamp written up front would make the next boot skip a
    // stage that never finished.
    assert.match(
      bootstrap,
      new RegExp(`codev_stage_record ${stage} "\\$\\{${stage}_key\\}"`),
      `${stage} should record its key once it succeeds`,
    );
  }

  // The two downloads worth singling out, both hundreds of megabytes: Orca
  // keys on the checksum the build published, fetched on its own so the
  // archive itself is never pulled when the host already has that build.
  assert.match(
    bootstrap,
    /orca_key="\$\(codev_stage_key orca-v1 "\$\(cat "\$\{work_dir\}\/\$\{orca_archive\}\.sha256"\)"\)"/,
  );
  const orcaStage = between(bootstrap, 'orca_key="', "codev_stage_record orca");
  assert.doesNotMatch(
    orcaStage.slice(0, orcaStage.indexOf("else")),
    /codev_fetch "\$\{orca_archive\}"/,
    "the Orca archive must be fetched inside the stage, not before its guard",
  );

  // And the guest rootfs names every input it bakes in: the Ubuntu image, this
  // release's guest daemon, the Superset archive checksum, and the two keys
  // standing for the host files it copies from.
  const rootfsStage = between(
    bootstrap,
    "rootfs_key=",
    "if codev_stage_done rootfs",
  );
  for (const input of [
    "rootfs-v2",
    "ubuntu-24.04.squashfs",
    "codev_fingerprint /usr/local/bin/codev-guestd",
    "superset_guest_archive}.sha256",
    "packages_key",
    "node_key",
  ]) {
    assert.ok(rootfsStage.includes(input), "rootfs key must include " + input);
  }
});

test("a bootstrap stage stamp tracks its key and honours the force switch", () => {
  const helpers = between(
    bootstrap,
    "codev_stage_key() {",
    "codev_public_ipv4() {",
  );
  const harness = `
set -euo pipefail
stamp_dir="$(mktemp -d)/stamps"
${helpers}
key_a="$(codev_stage_key demo one two)"
key_b="$(codev_stage_key demo one three)"
[[ "\${key_a}" != "\${key_b}" ]] || { echo "keys collided"; exit 1; }
# Nothing recorded yet, so the stage has to run.
codev_stage_done demo "\${key_a}" && { echo "ran without a stamp"; exit 1; }
codev_stage_record demo "\${key_a}"
codev_stage_done demo "\${key_a}" || { echo "repeated a current stage"; exit 1; }
# A changed input is a different key, and the stage runs again.
codev_stage_done demo "\${key_b}" && { echo "skipped a changed stage"; exit 1; }
CODEV_BOOTSTRAP_FORCE=1 codev_stage_done demo "\${key_a}" \
  && { echo "force did not override"; exit 1; }
echo ok
`;
  assert.equal(execFileSync("bash", ["-c", harness]).toString().trim(), "ok");
});

test("deployment shell scripts parse", () => {
  for (const script of [
    "scripts/bootstrap-host.sh",
    "scripts/build-orca-serve.sh",
    "scripts/build-orca-web.sh",
    "scripts/provision-host-image.sh",
    "../azure/deploy.sh",
    "../azure/build-host-image.sh",
  ]) {
    execFileSync("bash", ["-n", new URL(script, import.meta.url).pathname]);
  }
});

test("GitHub clone credentials stay out of git argv and persisted remotes", () => {
  const orcaBackend = read("../../services/orchestrator/src/backend/orca.rs");
  assert.match(orcaBackend, /\.env\("GIT_ASKPASS", GIT_ASKPASS_BIN\)/);
  assert.match(orcaBackend, /\.env\("CODEV_GITHUB_TOKEN", token\)/);
  assert.doesNotMatch(orcaBackend, /x-access-token:\{token\}@github\.com/);
});
