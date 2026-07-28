import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { executeInSandbox } from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";

const requestSchema = z.object({
  command: z.array(z.string().min(1).max(4_096)).min(1).max(32),
  workingDir: z.string().max(4_096).optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  rows: z.number().int().min(1).max(500).optional(),
  columns: z.number().int().min(1).max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);
  if (!workspace.canTerminal) {
    return apiError(new Error("Terminal capability is required."), 403);
  }

  try {
    const input = requestSchema.parse(await request.json());
    const result = await executeInSandbox(workspaceId, input);
    return Response.json({ result });
  } catch (error) {
    return apiError(error);
  }
}
