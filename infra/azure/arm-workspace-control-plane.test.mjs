import assert from "node:assert/strict";
import test from "node:test";
import { ArmWorkspaceControlPlane } from "./arm-workspace-control-plane.mjs";

test("checkpoints credentials through the authenticated control plane", async () => {
  const calls = [];
  const control = new ArmWorkspaceControlPlane({
    url: "https://app.example",
    secret: "secret",
    fetchImpl: async (...args) => {
      calls.push(args);
      return Response.json({ checkpointed: 2 });
    },
  });
  assert.deepEqual(await control.checkpointCredentials("workspace"), {
    checkpointed: 2,
  });
  assert.equal(calls[0][0], "https://app.example/api/gen2/agents/checkpoint");
  assert.equal(calls[0][1].headers.authorization, "Bearer secret");
});
