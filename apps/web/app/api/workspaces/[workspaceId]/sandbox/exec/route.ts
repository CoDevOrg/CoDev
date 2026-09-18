import { z } from "zod";

import { apiError } from "@/lib/api";
import { withWorkspace } from "@/lib/api-route";
import { executeInSandbox } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const maxDuration = 300;

const requestSchema = z.object({
  command: z.array(z.string().min(1).max(4_096)).min(1).max(32),
  workingDir: z.string().max(4_096).optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  rows: z.number().int().min(1).max(500).optional(),
  columns: z.number().int().min(1).max(500).optional(),
});

export const POST = withWorkspace(
  "terminalWrite",
  async ({ request, user, workspaceId }) => {
    try {
      const input = requestSchema.parse(await request.json());
      await ensureWorkspaceRuntimeReady(workspaceId, user.id);
      const result = await executeInSandbox(workspaceId, input);
      return Response.json({ result });
    } catch (error) {
      return apiError(error);
    }
  },
);
