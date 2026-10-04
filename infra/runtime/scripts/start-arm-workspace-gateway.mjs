import { createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createWorkspaceGateway } from "./arm-workspace-gateway.mjs";

const execute = promisify(execFile);
const config = JSON.parse(
  await readFile("/etc/codev/arm-runtime.json", "utf8"),
);
if (
  typeof config.workspaceId !== "string" ||
  !Number.isSafeInteger(config.generation) ||
  config.generation < 1 ||
  typeof config.diskUuid !== "string" ||
  typeof config.audience !== "string"
)
  throw new Error("Invalid runtime identity");
const identity = {
  ...config,
  verificationKey: createPublicKey(config.verificationKey),
};
const manifest = JSON.parse(
  await readFile("/usr/share/codev-arm-runtime.json", "utf8"),
);

async function readiness() {
  const { stdout } = await execute(
    "/usr/bin/findmnt",
    ["--mountpoint", "/workspace", "--noheadings", "--output", "UUID,FSTYPE"],
    { timeout: 5000 },
  );
  const [uuid, filesystem] = stdout.trim().split(/\s+/);
  const bridge = await fetch("http://127.0.0.1:5252/v1/superset/health", {
    signal: AbortSignal.timeout(5000),
  });
  return {
    ready: bridge.ok && uuid === config.diskUuid && filesystem === "ext4",
    diskUuid: uuid,
    diskMounted: uuid === config.diskUuid && filesystem === "ext4",
    bridgeReady: bridge.ok,
    releaseVersion: manifest.releaseVersion,
  };
}

createWorkspaceGateway(identity, readiness).listen(5260, "127.0.0.1");
