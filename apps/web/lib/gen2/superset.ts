import "server-only";

import { z } from "zod";

import { orchestratorRequest } from "../runtime/orchestrator-request";
import { canRunGen2Agent } from "./agent-policy";
import { Gen2LifecycleError } from "./errors";
import { requireGen2Member } from "./workspaces";

const healthSchema = z.object({ status: z.literal("ok") });

/** Keep the Superset service private to the guest; expose only readiness. */
export async function getGen2SupersetHealth(
  workspaceId: string,
  userId: string,
) {
  const workspace = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(workspace.status)) {
    throw new Gen2LifecycleError(
      workspace.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance first.",
    );
  }
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/superset/health`,
    undefined,
    10_000,
  );
  return healthSchema.parse(await response.json());
}
