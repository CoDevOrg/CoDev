import type { Gen2WorkspaceStatus } from "@codev/contracts";

export function canRunGen2Agent(status: Gen2WorkspaceStatus) {
  return status === "ready";
}
