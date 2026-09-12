import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const template = read("./cloudformation/runtime.yaml");
const deploy = read("./deploy.sh");
const bootstrap = read("./scripts/bootstrap-host.sh");
const buildOrca = read("./scripts/build-orca-serve.sh");
const buildOrcaWeb = read("./scripts/build-orca-web.sh");
const azureTemplate = read("../azure/main.bicep");
const azureDeploy = read("../azure/deploy.sh");

test("defaults the Firecracker host to on-demand capacity with nested KVM", () => {
  assert.match(template, /Default: m7i-flex\.large/);
  assert.match(template, /Default: x86_64/);
  // On-demand, not Spot: a stopped Spot instance can refuse to restart when
  // its pool is full, which strands a workspace that is only ever reopened
  // by starting the host back up.
  assert.match(template, /Default: on-demand/);
  assert.match(template, /NestedVirtualization: enabled/);
  // Spot stays selectable, and still needs these to be stoppable/resumable.
  assert.match(template, /InstanceInterruptionBehavior: stop/);
  assert.match(template, /SpotInstanceType: persistent/);
});

test("stops the host after ten idle minutes, counting IDE sessions", () => {
  assert.match(bootstrap, /CODEV_HOST_IDLE_TIMEOUT=10m/);
  assert.match(bootstrap, /CODEV_IDE_IDLE_TIMEOUT=10m/);
  const orchestrator = read(
    "../../services/orchestrator/src/bin/orchestrator.rs",
  );
  // An Orca-only workspace never provisions a sandbox, so the host's idle
  // check has to consult the IDE backend or it powers off mid-session - and
  // it has to measure last *use*, not session existence, or an abandoned
  // session buys the host a second full idle window when the reaper clears
  // it.
  assert.match(orchestrator, /ide\s*\n?\s*\.last_activity_at\(\)/);
  assert.match(orchestrator, /\.map_or\(since, \|last\| last\.max\(since\)\)/);
});

test("builds and bootstraps architecture-specific runtime artifacts", () => {
  assert.match(deploy, /x86_64-unknown-linux-musl/);
  assert.match(deploy, /aarch64-unknown-linux-musl/);
  assert.match(deploy, /CODEV_PURCHASE_OPTION:-on-demand/);
  assert.match(bootstrap, /codev-orchestrator-linux-\$\{artifact_arch\}/);
  assert.match(bootstrap, /\n  gh \\\n/);
  assert.match(
    bootstrap,
    /firecracker-\$\{firecracker_version\}-\$\{firecracker_arch\}/,
  );
  assert.match(buildOrca, /TARGET_ARCH=\$\{electron_arch\}/);
  assert.match(buildOrcaWeb, /corepack pnpm@10\.24\.0/);
  assert.match(buildOrcaWeb, /rsync -a --delete/);
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
  const unit = azureTemplate.slice(
    azureTemplate.indexOf("path: /etc/systemd/system/codev-bootstrap.service"),
    azureTemplate.indexOf("runcmd:"),
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
  const fetch = bootstrap.slice(
    bootstrap.indexOf("codev_fetch() {"),
    bootstrap.indexOf("codev_public_ipv4() {"),
  );
  assert.match(fetch, /staging="\$\{destination\}\.codev-fetch\.\$\$"/);
  assert.match(
    fetch,
    /aws s3 cp "\$\{release_prefix\}\/\$\{name\}" "\$\{staging\}"/,
  );
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

// apps/web's health check calls /healthz. On AWS that goes through API
// Gateway; on Azure the bearer route on the host is the only way in, so it has
// to match /healthz as well as /v1/*. The Caddyfile block is written twice, in
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

test("deployment shell scripts parse", () => {
  for (const script of [
    "deploy.sh",
    "scripts/bootstrap-host.sh",
    "scripts/build-orca-serve.sh",
    "scripts/build-orca-web.sh",
    "../azure/deploy.sh",
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
