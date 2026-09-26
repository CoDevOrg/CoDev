import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const artifactRoot = resolve(process.argv[2] ?? "");
if (process.platform !== "linux" || !process.argv[2]) {
  throw new Error(
    "Usage on Linux: node verify-superset-host-artifact.mjs <unpacked-artifact>",
  );
}
for (const name of [
  "host-service.js",
  "host-worker.js",
  "pty-daemon.js",
  "host-migrations/meta/_journal.json",
  "chat-migrations/meta/_journal.json",
  "agent-templates/notify-hook.template.sh",
]) {
  if (!existsSync(join(artifactRoot, name)))
    throw new Error(`Artifact is missing ${name}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a port");
  await new Promise((done) => server.close(done));
  return address.port;
}

const stateDir = mkdtempSync(join(tmpdir(), "codev-superset-host-smoke-"));
mkdirSync(join(stateDir, "home"));
const port = await freePort();
const organizationId = "00000000-0000-4000-8000-000000000001";
const manifestPath = join(
  stateDir,
  "home",
  ".superset",
  "host",
  organizationId,
  "pty-daemon-manifest.json",
);
let output = "";
let daemonPid = null;
const child = spawn(process.execPath, [join(artifactRoot, "host-service.js")], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: join(stateDir, "home"),
    SUPERSET_HOME_DIR: join(stateDir, "home", ".superset"),
    HOST_SERVICE_SECRET: "artifact-smoke-secret",
    ORGANIZATION_ID: organizationId,
    HOST_DB_PATH: join(stateDir, "host.db"),
    HOST_MIGRATIONS_FOLDER: join(artifactRoot, "host-migrations"),
    SUPERSET_CHAT_V3_MIGRATIONS: join(artifactRoot, "chat-migrations"),
    // Health does not need Superset cloud. The CoDev run mode is a later step.
    AUTH_TOKEN: "artifact-smoke-token",
    SUPERSET_API_URL: "http://127.0.0.1:9",
    SUPERSET_PTY_DAEMON_SCRIPT_PATH: join(artifactRoot, "pty-daemon.js"),
    PORT: String(port),
    NODE_ENV: "development",
  },
});
child.stdout?.on("data", (chunk) => {
  output += chunk;
});
child.stderr?.on("data", (chunk) => {
  output += chunk;
});

try {
  let healthy = false;
  let lastResponse = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/trpc/health.check`,
        {
          signal: AbortSignal.timeout(1000),
        },
      );
      lastResponse = await response.text();
      const payload = JSON.parse(lastResponse);
      if (
        response.ok &&
        (payload.result?.data?.status === "ok" ||
          payload.result?.data?.json?.status === "ok")
      ) {
        healthy = true;
        break;
      }
    } catch {
      // The service may still be applying its database migrations.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!healthy)
    throw new Error(
      `Host service did not answer health.check (last response: ${lastResponse}):\n${output.slice(-4000)}`,
    );
  // The host starts its detached daemon asynchronously. Wait for its manifest
  // before ending the check, or cleanup may race a daemon launched afterward.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (existsSync(manifestPath)) {
      try {
        const pid = JSON.parse(readFileSync(manifestPath, "utf8")).pid;
        if (Number.isInteger(pid)) {
          process.kill(pid, 0);
          daemonPid = pid;
          break;
        }
      } catch {
        /* manifest is still being written */
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!daemonPid)
    throw new Error(
      `Bundled PTY daemon did not become ready:\n${output.slice(-4000)}`,
    );
  console.log(
    "Standalone host service and PTY daemon answered health checks on Linux",
  );
} finally {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
  }
  await new Promise((done) => setTimeout(done, 250));
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
  }
  if (!daemonPid && existsSync(manifestPath)) {
    try {
      const pid = JSON.parse(readFileSync(manifestPath, "utf8")).pid;
      if (Number.isInteger(pid)) daemonPid = pid;
    } catch {
      /* daemon has already exited */
    }
  }
  if (daemonPid) {
    try {
      process.kill(daemonPid, "SIGTERM");
    } catch {
      /* already exited */
    }
  }
  rmSync(stateDir, { recursive: true, force: true });
}
