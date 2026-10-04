import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ArmWorkspaceAzure } from "./arm-workspace-azure.mjs";
import { ArmWorkspaceBlobState } from "./arm-workspace-blob-state.mjs";
import { ArmWorkspaceGuest } from "./arm-workspace-guest.mjs";
import { ArmWorkspaceLifecycle } from "./arm-workspace-lifecycle.mjs";
import { ArmWorkspaceTunnel } from "./arm-workspace-tunnel.mjs";

const required = [
  "GITHUB_RUN_ID",
  "AZURE_RESOURCE_GROUP",
  "CODEV_ARTIFACT_ACCOUNT",
  "AZURE_SUBSCRIPTION_ID",
  "CLOUDFLARE_API_TOKEN",
  "PHASE2_SIGNING_KEY",
  "PHASE2_VERIFY_KEY",
  "PHASE2_SSH_PUBLIC_KEY",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const workspaceId = `phase2-${process.env.GITHUB_RUN_ID}`;
const imageId =
  `/subscriptions/${process.env.AZURE_SUBSCRIPTION_ID}` +
  `/resourceGroups/${process.env.AZURE_RESOURCE_GROUP}` +
  "/providers/Microsoft.Compute/galleries/codevarmworkspacegallery" +
  "/images/codev-workspace-arm64/versions/1.0.10";
const token = execFileSync(
  "az",
  [
    "account",
    "get-access-token",
    "--resource",
    "https://storage.azure.com/",
    "--query",
    "accessToken",
    "-o",
    "tsv",
  ],
  { encoding: "utf8" },
).trim();
const state = new ArmWorkspaceBlobState(
  process.env.CODEV_ARTIFACT_ACCOUNT,
  token,
);
const azure = new ArmWorkspaceAzure({
  resourceGroup: process.env.AZURE_RESOURCE_GROUP,
  imageId,
  adminPublicKeyPath: process.env.PHASE2_SSH_PUBLIC_KEY,
});
const guest = new ArmWorkspaceGuest({
  publicKeyPath: process.env.PHASE2_VERIFY_KEY,
});
const tunnel = new ArmWorkspaceTunnel({
  accountId: "84a1d01866de04e04320feddfb199b83",
  zoneId: "c474dbc7af01ea073573a250fbd1d5ec",
  zoneName: "trycodev.com",
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  signingKeyPath: process.env.PHASE2_SIGNING_KEY,
  guest,
});
let now = Date.now();
const lifecycle = new ArmWorkspaceLifecycle(
  state,
  azure,
  tunnel,
  guest,
  () => now,
);
const startedAt = Date.now();
let completed = false;

try {
  const first = await lifecycle.start(workspaceId, "canary-start-1");
  assert.equal(first.status, "ready");
  assert.equal(first.generation, 1);
  assert.ok(first.diskUuid);
  const saved = await guest.command(
    first.vmId,
    "set -e; runuser -u codev-shell -- sh -ec '" +
      "printf phase2-canary-file >/workspace/phase2-canary.txt; " +
      "git -C /workspace init -q; git -C /workspace -c user.name=Canary " +
      "-c user.email=canary@example.invalid commit -q --allow-empty -m seed; " +
      "git -C /workspace worktree add -q -b canary /workspace/canary-tree; " +
      "printf stale >/workspace/.git/index.lock; " +
      "printf worktree-saved >/workspace/canary-tree/proof.txt'; " +
      "setpriv --reuid=2101 --regid=2000 --clear-groups -- sh -ec 'umask 0002; " +
      "mkdir /workspace/ownership-proof; " +
      "printf first-writer >/workspace/ownership-proof/proof.txt'; " +
      "printf phase2-canary-private >/workspace/.codev-runtime/superset/phase2-canary.txt; " +
      "printf 'SAVED'",
  );
  assert.equal(saved, "SAVED");
  const firstSeconds = Math.round((Date.now() - startedAt) / 1000);
  const again = await lifecycle.start(workspaceId, "canary-start-1");
  assert.equal(again.vmId, first.vmId);
  const stopped = await lifecycle.stop(workspaceId, "canary-stop-1");
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.dataDiskId, first.dataDiskId);
  const disk = await azure.requireDisk(first.dataDiskId, workspaceId);
  assert.equal(disk.id, first.dataDiskId);
  const reopenAt = Date.now();
  const second = await lifecycle.start(workspaceId, "canary-start-2");
  assert.equal(second.status, "ready");
  assert.equal(second.diskUuid, first.diskUuid);
  assert.notEqual(second.vmId, first.vmId);
  const evidence = await guest.command(
    second.vmId,
    "set -e; runuser -u codev-shell -- sh -ec 'cat /workspace/phase2-canary.txt; " +
      "cat /workspace/canary-tree/proof.txt; git -C /workspace worktree list; " +
      "test ! -e /workspace/.git/index.lock; " +
      "test ! -r /workspace/.codev-runtime/superset/phase2-canary.txt'; " +
      "setpriv --reuid=2102 --regid=2000 --clear-groups -- sh -ec 'umask 0002; " +
      "printf -- -second-writer >>/workspace/ownership-proof/proof.txt'; " +
      "cat /workspace/ownership-proof/proof.txt; " +
      "stat -c '%u:%g:%a' /workspace/ownership-proof; " +
      "stat -c '%u:%g:%a' /workspace/ownership-proof/proof.txt; " +
      "cat /workspace/.codev-runtime/superset/phase2-canary.txt; " +
      "stat -c '%u:%g:%a' /workspace/.codev-runtime; " +
      "blkid -s UUID -o value /dev/disk/azure/scsi1/lun0",
  );
  assert.match(evidence, /phase2-canary-file/);
  assert.match(evidence, /phase2-canary-private/);
  assert.match(evidence, /worktree-saved/);
  assert.match(evidence, /canary-tree/);
  assert.match(evidence, /first-writer-second-writer/);
  assert.match(evidence, /2101:2000:2775/);
  assert.match(evidence, /2101:2000:664/);
  assert.match(evidence, /0:0:700/);
  assert.match(evidence, new RegExp(first.diskUuid));
  now += 15 * 60_000;
  const idle = await lifecycle.idle(workspaceId);
  assert.equal(idle.status, "stopped");
  await lifecycle.delete(workspaceId, {
    workspaceId,
    productDeletedAt: Date.now(),
  });
  completed = true;
  console.log(
    JSON.stringify({
      status: "passed",
      workspaceId,
      imageVersion: "1.0.10",
      firstStartSeconds: firstSeconds,
      reopenSeconds: Math.round((Date.now() - reopenAt) / 1000),
      generations: [first.generation, second.generation],
      diskRetainedThenDeleted: true,
    }),
  );
} finally {
  if (!completed) {
    try {
      await lifecycle.delete(workspaceId, {
        workspaceId,
        productDeletedAt: Date.now(),
      });
      console.log("Disposable canary cleaned up after failure");
    } catch (error) {
      console.error(`Canary cleanup needs operator review: ${error.message}`);
      // This run owns only a disposable test workspace. Revoke compute even if
      // a Cloudflare permission failure prevents normal route cleanup.
      for (const generation of [1, 2, 3]) {
        await azure
          .cleanupGeneration(workspaceId, generation)
          .catch((failure) =>
            console.error(`Azure generation ${generation}: ${failure.message}`),
          );
      }
      const diskId = (await state.read(workspaceId).catch(() => null))?.state
        .dataDiskId;
      if (diskId)
        await azure
          .deleteOwnedDisk(diskId, workspaceId)
          .catch((failure) =>
            console.error(`Disposable disk: ${failure.message}`),
          );
    }
  }
}
