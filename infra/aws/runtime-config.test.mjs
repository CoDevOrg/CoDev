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
  assert.match(buildOrcaWeb, /apply --check/);
  assert.match(buildOrcaWeb, /corepack pnpm@10\.24\.0/);
  assert.match(buildOrcaWeb, /rsync -a --delete/);
});

test("deployment shell scripts parse", () => {
  for (const script of [
    "deploy.sh",
    "scripts/bootstrap-host.sh",
    "scripts/build-orca-serve.sh",
    "scripts/build-orca-web.sh",
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
