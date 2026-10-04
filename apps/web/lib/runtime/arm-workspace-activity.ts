import "server-only";

import { armWorkspaceRequest } from "./arm-workspace-request";
import { workspaceRuntimeTarget } from "./workspace-runtime-target";

/** A read-only observation; an unreachable bridge must block idle shutdown. */
export async function armWorkspaceAgentRunning(workspaceId: string) {
  const target = await workspaceRuntimeTarget(workspaceId);
  if (!target) throw new Error("An ARM workspace is required.");
  const response = await armWorkspaceRequest(
    target,
    "GET",
    "/v1/runtime-activity",
    undefined,
    10_000,
  );
  const payload = (await response.json()) as { running?: boolean };
  if (!response.ok || typeof payload.running !== "boolean") {
    throw new Error("ARM agent activity could not be observed.");
  }
  return payload.running;
}
