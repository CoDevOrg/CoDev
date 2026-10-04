import assert from "node:assert/strict";
import test from "node:test";
import { ArmWorkspaceLifecycle } from "./arm-workspace-lifecycle.mjs";

function fixture() {
  let now = 1_800_000_000_000;
  let saved;
  let etag = 0;
  let leased = false;
  const calls = [];
  let failVm = false;
  let failCleanup = false;
  let failTunnel = false;
  let pauseVm;
  let runningAgent = false;
  let failCheckpoint = false;
  const state = {
    async initialize(id) {
      saved ??= {
        workspaceId: id,
        status: "stopped",
        generation: 0,
        dataDiskId: null,
        diskUuid: null,
        lastVmGeneration: null,
        operation: null,
      };
    },
    async acquire() {
      if (leased) throw new Error("WORKSPACE_BUSY");
      leased = true;
      return "lease";
    },
    async renew() {
      if (!leased) throw new Error("LEASE_LOST");
    },
    async release() {
      leased = false;
    },
    async read() {
      return { state: structuredClone(saved), etag: String(etag) };
    },
    async write(_id, _lease, old, next) {
      assert.equal(old, String(etag));
      saved = structuredClone(next);
      return String(++etag);
    },
  };
  const azure = {
    async createDisk() {
      calls.push("disk");
      return { id: "disk-1" };
    },
    async requireDisk(id) {
      calls.push("require-disk");
      return { id };
    },
    async requireUnattachedDisk() {
      calls.push("unattached-disk");
    },
    async requireGenerationDeleted(_workspace, generation) {
      calls.push(`absent-${generation}`);
    },
    async createVm(_workspace, generation) {
      calls.push(`vm-${generation}`);
      if (pauseVm) await pauseVm;
      if (failVm)
        throw Object.assign(new Error("Conflict"), { code: "Conflict" });
      return { id: `vm-${generation}` };
    },
    async waitRunning() {
      calls.push("running");
    },
    async cleanupGeneration(_workspace, generation) {
      calls.push(`cleanup-${generation}`);
      if (failCleanup) throw new Error("AZURE_DELETE_FAILED");
    },
    async reconcileGeneration(_workspace, generation) {
      calls.push(`reconcile-${generation}`);
    },
    async deleteOwnedDisk() {
      calls.push("delete-disk");
    },
  };
  const tunnel = {
    async ensure() {
      calls.push("tunnel");
      return { id: "tunnel-1", host: "opaque.example" };
    },
    async health() {
      calls.push("health");
      return { ready: true };
    },
    async revokeGeneration(_workspace, generation) {
      calls.push(`revoke-${generation}`);
      if (failTunnel) throw new Error("TUNNEL_FAILED");
    },
  };
  const guest = {
    async prepare() {
      calls.push("prepare");
      return "saved-uuid";
    },
    async flush() {
      calls.push("flush");
    },
    async hasRunningAgents() {
      return runningAgent;
    },
  };
  const checkpointCredentials = async () => {
    calls.push("checkpoint");
    if (failCheckpoint) throw new Error("CREDENTIAL_CHECKPOINT_FAILED");
  };
  return {
    service: new ArmWorkspaceLifecycle(
      state,
      azure,
      tunnel,
      guest,
      () => now,
      checkpointCredentials,
    ),
    calls,
    state,
    advance: (ms) => {
      now += ms;
    },
    failVm: (value) => {
      failVm = value;
    },
    failCleanup: (value) => {
      failCleanup = value;
    },
    failTunnel: (value) => {
      failTunnel = value;
    },
    failCheckpoint: (value) => {
      failCheckpoint = value;
    },
    pauseVm: (value) => {
      pauseVm = value;
    },
    seed: (value) => {
      saved = structuredClone(value);
      etag++;
    },
    runningAgent: (value) => {
      runningAgent = value;
    },
  };
}

test("start is idempotent and saved disk identity survives stop and reopen", async () => {
  const f = fixture();
  const started = await f.service.start("workspace", "start-1");
  assert.equal(started.status, "ready");
  assert.equal(started.diskUuid, "saved-uuid");
  await f.service.start("workspace", "start-1");
  assert.equal(f.calls.filter((call) => call === "disk").length, 1);
  await f.service.stop("workspace", "stop-1");
  const reopened = await f.service.start("workspace", "start-2");
  assert.equal(reopened.generation, 3);
  assert.equal(reopened.dataDiskId, "disk-1");
  assert.equal(f.calls.filter((call) => call === "disk").length, 1);
  assert.ok(f.calls.indexOf("revoke-1") < f.calls.indexOf("cleanup-1"));
  assert.ok(f.calls.indexOf("unattached-disk") < f.calls.indexOf("vm-1"));
  assert.ok(f.calls.indexOf("absent-1") < f.calls.indexOf("vm-3"));
});

test("transient Azure conflict persists failure, backoff, then reconciles old generation", async () => {
  const f = fixture();
  f.failVm(true);
  await assert.rejects(f.service.start("workspace", "first"), /Conflict/);
  const failed = (await f.state.read()).state;
  assert.equal(failed.status, "failed");
  assert.equal(failed.dataDiskId, "disk-1");
  assert.equal(failed.errorCode, "ALLOCATION_FAILED");
  await assert.rejects(f.service.start("workspace", "second"), /RETRY_BACKOFF/);
  f.advance(2_001);
  f.failVm(false);
  const ready = await f.service.start("workspace", "second");
  assert.equal(ready.status, "ready");
  assert.ok(f.calls.includes("reconcile-1"));
  assert.equal(f.calls.filter((call) => call === "disk").length, 1);
});

test("idle stop uses member input and live agent work, not health checks", async () => {
  const f = fixture();
  await f.service.start("workspace", "start");
  f.advance(15 * 60_000);
  f.runningAgent(true);
  assert.equal((await f.service.idle("workspace")).status, "ready");
  f.runningAgent(false);
  assert.equal((await f.service.idle("workspace")).status, "ready");
  f.advance(15 * 60_000);
  assert.equal((await f.service.idle("workspace")).status, "stopped");
  assert.equal(f.calls.filter((call) => call === "cleanup-1").length, 1);
});

test("disk deletion needs product receipt and follows routing and compute cleanup", async () => {
  const f = fixture();
  await f.service.start("workspace", "start");
  await assert.rejects(
    f.service.delete("workspace", {}),
    /PRODUCT_DELETE_REQUIRED/,
  );
  assert.equal(f.calls.includes("delete-disk"), false);
  const done = await f.service.delete("workspace", {
    workspaceId: "workspace",
    productDeletedAt: 123,
  });
  assert.equal(done.dataDiskId, null);
  assert.ok(f.calls.indexOf("revoke-1") < f.calls.indexOf("cleanup-1"));
  assert.ok(f.calls.indexOf("cleanup-1") < f.calls.indexOf("delete-disk"));
});

test("concurrent starts hold one durable lease and create one VM", async () => {
  const f = fixture();
  let release;
  f.pauseVm(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const first = f.service.start("workspace", "start-1");
  for (let attempt = 0; attempt < 20 && !f.calls.includes("vm-1"); attempt++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.calls.includes("vm-1"));
  await assert.rejects(
    f.service.start("workspace", "start-2"),
    /WORKSPACE_BUSY/,
  );
  release();
  assert.equal((await first).status, "ready");
  assert.equal((await f.service.start("workspace", "start-1")).status, "ready");
  assert.equal(f.calls.filter((call) => call === "vm-1").length, 1);
});

test("reconciler resumes an expired generation without replacing its disk", async () => {
  const f = fixture();
  f.seed({
    workspaceId: "workspace",
    status: "provisioning",
    generation: 1,
    dataDiskId: "disk-1",
    diskUuid: null,
    operation: {
      id: "lost",
      key: "start-1",
      kind: "start",
      leaseUntil: 1_800_000_000_000 - 1,
      attempts: 0,
    },
  });
  const result = await f.service.reconcile("workspace");
  assert.equal(result.status, "ready");
  assert.equal(result.dataDiskId, "disk-1");
  assert.equal(f.calls.filter((call) => call === "disk").length, 0);
  assert.equal(f.calls.filter((call) => call === "vm-1").length, 1);
});

test("six allocation failures end in a terminal safe state", async () => {
  const f = fixture();
  f.failVm(true);
  for (let attempt = 1; attempt <= 6; attempt++) {
    await assert.rejects(
      f.service.start("workspace", `start-${attempt}`),
      /Conflict/,
    );
    const failed = (await f.state.read()).state;
    assert.equal(failed.failureAttempts, attempt);
    if (attempt < 6) f.advance(failed.retryAt - 1_800_000_000_000 + 1);
  }
  const failed = (await f.state.read()).state;
  assert.equal(failed.errorTerminal, true);
  assert.equal(failed.retryAt, null);
  await assert.rejects(
    f.service.start("workspace", "start-7"),
    /WORKSPACE_TERMINAL_FAILURE/,
  );
});

test("partial stop resumes cleanup without flushing a deleted VM twice", async () => {
  const f = fixture();
  await f.service.start("workspace", "start");
  f.failCleanup(true);
  await assert.rejects(
    f.service.stop("workspace", "stop"),
    /AZURE_DELETE_FAILED/,
  );
  const pending = (await f.state.read()).state;
  assert.equal(pending.status, "stopping");
  assert.equal(pending.flushRequired, false);
  assert.equal(pending.dataDiskId, "disk-1");
  f.failCleanup(false);
  f.advance(90_001);
  assert.equal((await f.service.reconcile("workspace")).status, "stopped");
  assert.equal(f.calls.filter((call) => call === "flush").length, 1);
  assert.equal(f.calls.filter((call) => call === "cleanup-1").length, 2);
  assert.equal(f.calls.includes("delete-disk"), false);
});

test("credential checkpoint failure aborts normal VM deletion", async () => {
  const f = fixture();
  await f.service.start("workspace", "start");
  f.failCheckpoint(true);
  await assert.rejects(
    f.service.stop("workspace", "stop"),
    /CREDENTIAL_CHECKPOINT_FAILED/,
  );
  assert.ok(f.calls.includes("checkpoint"));
  assert.equal(f.calls.includes("flush"), false);
  assert.equal(f.calls.includes("cleanup-1"), false);
});

test("a tunnel revoke error still releases billable compute", async () => {
  const f = fixture();
  await f.service.start("workspace", "start");
  f.failTunnel(true);
  await assert.rejects(f.service.stop("workspace", "stop"), /TUNNEL_FAILED/);
  assert.ok(f.calls.includes("cleanup-1"));
  assert.equal((await f.state.read()).state.status, "stopping");
  f.failTunnel(false);
  f.advance(90_001);
  assert.equal((await f.service.reconcile("workspace")).status, "stopped");
});
