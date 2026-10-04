import type { Gen2RuntimeStatus } from "@codev/contracts";

export function workspaceStartupProgress(status: Gen2RuntimeStatus | null) {
  switch (status) {
    case "queued":
      return "Your workspace is waiting to start.";
    case "provisioning":
      return "Preparing your workspace machine.";
    case "booting":
      return "Booting your workspace machine.";
    case "attaching_disk":
      return "Attaching your saved workspace files.";
    case "starting_tunnel":
      return "Opening the secure workspace connection.";
    case "checking_readiness":
    case "ready":
      return "Checking the live workspace connection.";
    case "stopping":
      return "Waiting for the workspace to finish stopping.";
    default:
      return "Starting your workspace. Your saved files will be preserved.";
  }
}
