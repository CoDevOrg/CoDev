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
  let runningAgent = false;
  const state = {
    async initialize(id) {
      saved ??= {
        workspaceId: id,
        status: "stopped",
        generation: 0,
        dataDiskId: null,
        diskUuid: null,
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
    async createVm(_workspace, generation) {
      calls.push(`vm-${generation}`);
      if (failVm)
        throw Object.assign(new Error("Conflict"), { code: "Conflict" });
      return { id: `vm-${generation}` };
    },
    async waitRunning() {
      calls.push("running");
    },
    async cleanupGeneration(_workspace, generation) {
      calls.push(`cleanup-${generation}`);
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
  return {
    service: new ArmWorkspaceLifecycle(state, azure, tunnel, guest, () => now),
    calls,
    state,
    advance: (ms) => {
      now += ms;
    },
    failVm: (value) => {
      failVm = value;
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
  f.advance(1_001);
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
