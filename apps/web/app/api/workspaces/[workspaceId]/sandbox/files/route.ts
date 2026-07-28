import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { readSandboxFile, writeSandboxFile } from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";

const readSchema = z.object({ path: z.string().min(1).max(4_096) });
const writeSchema = readSchema.extend({
  contents: z.string().max(2 * 1_024 * 1_024),
  expectedRevision: z.string().min(1),
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

  try {
    const input = readSchema.parse(await request.json());
    const file = await readSandboxFile(workspaceId, input.path);
    return Response.json({ file });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);

  try {
    const input = writeSchema.parse(await request.json());
    const result = await writeSandboxFile(workspaceId, input);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
