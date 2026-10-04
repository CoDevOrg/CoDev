import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { azureCli } from "./arm-workspace-azure-cli.mjs";

const template = fileURLToPath(
  new URL("./arm-workspace-vm.bicep", import.meta.url),
);
const stopScript = fileURLToPath(
  new URL("./stop-arm-workspace-vm.sh", import.meta.url),
);
const run = promisify(execFile);

function baseName(workspaceId) {
  return `codev-ws-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 16)}`;
}

function checkOwned(resource, workspaceId) {
  if (
    resource.tags?.Runtime !== "arm-workspace" ||
    resource.tags?.WorkspaceId !== workspaceId
  )
    throw new Error("RESOURCE_OWNERSHIP_MISMATCH");
}

export class ArmWorkspaceAzure {
  constructor({ resourceGroup, imageId, adminPublicKeyPath }) {
    if (
      !/^codev-arm-workspace-[a-z0-9-]+$/.test(resourceGroup) ||
      !imageId.endsWith("/versions/1.0.10") ||
      !adminPublicKeyPath
    )
      throw new Error("Isolated ARM configuration required");
    this.group = resourceGroup;
    this.imageId = imageId;
    this.adminPublicKeyPath = adminPublicKeyPath;
  }

  async createDisk(workspaceId) {
    const name = `${baseName(workspaceId)}-data`;
    const existing = await azureCli([
      "disk",
      "list",
      "-g",
      this.group,
      "--query",
      `[?name=='${name}'] | [0]`,
      "-o",
      "json",
    ]);
    if (existing !== "null") {
      const disk = JSON.parse(existing);
      checkOwned(disk, workspaceId);
      if (
        (disk.diskSizeGB ?? disk.diskSizeGb) !== 16 ||
        disk.sku?.name !== "StandardSSD_LRS"
      )
        throw new Error("DISK_SIZE_MISMATCH");
      return { id: disk.id };
    }
    const disk = JSON.parse(
      await azureCli([
        "disk",
        "create",
        "-g",
        this.group,
        "-n",
        name,
        "--location",
        "westus2",
        "--size-gb",
        "16",
        "--sku",
        "StandardSSD_LRS",
        "--tags",
        "Runtime=arm-workspace",
        `WorkspaceId=${workspaceId}`,
        "--query",
        "{id:id}",
        "-o",
        "json",
      ]),
    );
    return disk;
  }

  async requireDisk(diskId, workspaceId) {
    const disk = JSON.parse(
      await azureCli(["disk", "show", "--ids", diskId, "-o", "json"]),
    );
    checkOwned(disk, workspaceId);
    if (
      (disk.diskSizeGB ?? disk.diskSizeGb) !== 16 ||
      disk.sku?.name !== "StandardSSD_LRS"
    )
      throw new Error("DISK_SIZE_MISMATCH");
    return { id: disk.id };
  }

  async createVm(workspaceId, generation, diskId) {
    const name = `${baseName(workspaceId)}-g${generation}`;
    await azureCli([
      "deployment",
      "group",
      "create",
      "-g",
      this.group,
      "-n",
      name,
      "--template-file",
      template,
      "--parameters",
      `instanceName=${name}`,
      `workspaceId=${workspaceId}`,
      `generation=${generation}`,
      `imageVersionId=${this.imageId}`,
      `dataDiskResourceId=${diskId}`,
      `adminSshPublicKey=@${this.adminPublicKeyPath}`,
      "--query",
      "properties.provisioningState",
      "-o",
      "tsv",
    ]);
    const vm = JSON.parse(
      await azureCli([
        "vm",
        "show",
        "-g",
        this.group,
        "-n",
        name,
        "-o",
        "json",
      ]),
    );
    checkOwned(vm, workspaceId);
    if (
      vm.tags.Generation !== String(generation) ||
      vm.storageProfile.dataDisks.length !== 1 ||
      vm.storageProfile.dataDisks[0].managedDisk.id.toLowerCase() !==
        diskId.toLowerCase()
    )
      throw new Error("DISK_ATTACH_CONFLICT");
    return { id: vm.id };
  }

  async waitRunning(vmId) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const view = JSON.parse(
        await azureCli([
          "vm",
          "get-instance-view",
          "--ids",
          vmId,
          "-o",
          "json",
        ]),
      );
      const running = view.instanceView.statuses.some(
        (s) => s.code === "PowerState/running",
      );
      const agent = view.instanceView.vmAgent?.statuses?.some(
        (s) => s.code === "ProvisioningState/succeeded",
      );
      if (running && agent) return;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    const error = new Error("READINESS_TIMEOUT");
    error.code = "READINESS_TIMEOUT";
    throw error;
  }

  async stopAndDelete(vmId, workspaceId) {
    const vm = JSON.parse(
      await azureCli(["vm", "show", "--ids", vmId, "-o", "json"]),
    );
    checkOwned(vm, workspaceId);
    await this.cleanupGeneration(workspaceId, Number(vm.tags.Generation));
  }

  async reconcileGeneration(workspaceId, generation) {
    await this.cleanupGeneration(workspaceId, generation);
  }

  async cleanupGeneration(workspaceId, generation) {
    const name = `${baseName(workspaceId)}-g${generation}`;
    await run("bash", [stopScript, name, workspaceId, String(generation)], {
      timeout: 600_000,
      env: { ...process.env, AZURE_RESOURCE_GROUP: this.group },
    });
  }

  async deleteOwnedDisk(diskId, workspaceId) {
    const disk = JSON.parse(
      await azureCli(["disk", "show", "--ids", diskId, "-o", "json"]),
    );
    checkOwned(disk, workspaceId);
    if (disk.diskState !== "Unattached" || disk.managedBy)
      throw new Error("DISK_ATTACH_CONFLICT");
    await azureCli(["disk", "delete", "--ids", diskId, "--yes"]);
  }
}
