import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { executeInSandbox } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

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
  try {
    await requireWorkspacePermission(workspaceId, user.id, "terminalWrite");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const input = requestSchema.parse(await request.json());
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const result = await executeInSandbox(workspaceId, input);
    return Response.json({ result });
  } catch (error) {
    return apiError(error);
  }
}
