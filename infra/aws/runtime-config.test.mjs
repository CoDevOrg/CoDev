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

test("defaults the Firecracker host to persistent Spot with nested KVM", () => {
  assert.match(template, /Default: m7i-flex\.large/);
  assert.match(template, /Default: x86_64/);
  assert.match(template, /Default: spot/);
  assert.match(template, /NestedVirtualization: enabled/);
  assert.match(template, /InstanceInterruptionBehavior: stop/);
  assert.match(template, /SpotInstanceType: persistent/);
});

test("builds and bootstraps architecture-specific runtime artifacts", () => {
  assert.match(deploy, /x86_64-unknown-linux-musl/);
  assert.match(deploy, /aarch64-unknown-linux-musl/);
  assert.match(deploy, /CODEV_PURCHASE_OPTION:-spot/);
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
