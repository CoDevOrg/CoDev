import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { azureCli } from "./arm-workspace-azure-cli.mjs";

const scripts = new URL("../runtime/scripts/", import.meta.url);
const names = [
  "arm-workspace-capability.mjs",
  "arm-workspace-gateway.mjs",
  "start-arm-workspace-gateway.mjs",
];

function extractStdout(message) {
  return (message.split("[stdout]\n")[1] ?? "").split("[stderr]")[0].trim();
}

export class ArmWorkspaceGuest {
  constructor({ publicKeyPath }) {
    this.publicKeyPath = publicKeyPath;
  }

  async command(vmId, script, parameters = []) {
    const result = JSON.parse(
      await azureCli([
        "vm",
        "run-command",
        "invoke",
        "--ids",
        vmId,
        "--command-id",
        "RunShellScript",
        "--scripts",
        script,
        ...(parameters.length ? ["--parameters", ...parameters] : []),
        "--query",
        "value[0].message",
        "-o",
        "json",
      ]),
    );
    return extractStdout(result);
  }

  async prepare(vmId, diskUuid) {
    const script = fileURLToPath(
      new URL("prepare-arm-workspace-disk.sh", scripts),
    );
    const output = await this.command(
      vmId,
      `@${script}`,
      diskUuid ? ["existing", diskUuid] : ["new"],
    );
    const uuid = output.match(
      /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/m,
    )?.[0];
    if (!uuid || (diskUuid && uuid !== diskUuid))
      throw new Error("DISK_IDENTITY_MISMATCH");
    return uuid;
  }

  async install(vmId, { workspaceId, generation, host, token, diskUuid }) {
    if (!diskUuid) throw new Error("DISK_IDENTITY_MISSING");
    const publicKey = await readFile(this.publicKeyPath, "utf8");
    const identity = {
      workspaceId,
      generation,
      audience: host,
      diskUuid,
      verificationKey: publicKey,
      tunnelToken: token,
    };
    let script =
      "#!/bin/bash\nset -euo pipefail\numask 077\ninstall -d -m 0755 /usr/local/lib/codev\n";
    for (const name of names) {
      const bytes = await readFile(new URL(name, scripts));
      script += `base64 -d > /usr/local/lib/codev/${name} <<'DATA'\n`;
      script += `${bytes.toString("base64")}\nDATA\n`;
      script += `chmod 0644 /usr/local/lib/codev/${name}\n`;
    }
    const installer = await readFile(
      new URL("install-arm-workspace-connection.sh", scripts),
    );
    script += `base64 -d > /root/codev-install-connection.sh <<'DATA'\n`;
    script += `${installer.toString("base64")}\nDATA\n`;
    script += `base64 -d <<'CONFIG' | bash /root/codev-install-connection.sh\n`;
    script += `${Buffer.from(JSON.stringify(identity)).toString("base64")}\nCONFIG\n`;
    script += "rm /root/codev-install-connection.sh\n";
    const directory = await mkdtemp(join(tmpdir(), "codev-arm-ext-"));
    try {
      const settings = join(directory, "protected.json");
      await writeFile(
        settings,
        JSON.stringify({ script: gzipSync(script).toString("base64") }),
        { mode: 0o600 },
      );
      const parts = vmId.split("/");
      if (
        parts.length !== 9 ||
        parts[1] !== "subscriptions" ||
        parts[3] !== "resourceGroups" ||
        parts[6] !== "Microsoft.Compute" ||
        parts[7] !== "virtualMachines"
      )
        throw new Error("INVALID_VM_ID");
      const group = parts[4];
      const name = parts[8];
      const output = await azureCli([
        "vm",
        "extension",
        "set",
        "-g",
        group,
        "--vm-name",
        name,
        "--name",
        "CustomScript",
        "--publisher",
        "Microsoft.Azure.Extensions",
        "--version",
        "2.1",
        "--protected-settings",
        `@${settings}`,
        "--query",
        "provisioningState",
        "-o",
        "tsv",
      ]);
      if (output !== "Succeeded") throw new Error("TUNNEL_FAILED");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async hasRunningAgents(vmId) {
    const output = await this.command(
      vmId,
      "curl --fail --silent --show-error --max-time 8 http://127.0.0.1:5252/v1/agent-activity",
    );
    const value = JSON.parse(output);
    if (typeof value.running !== "boolean")
      throw new Error("AGENT_ACTIVITY_UNKNOWN");
    return value.running;
  }

  async flush(vmId) {
    await this.command(
      vmId,
      "curl --fail --silent --show-error --max-time 8 -X POST http://127.0.0.1:5252/v1/workspace/flush",
    );
  }
}
