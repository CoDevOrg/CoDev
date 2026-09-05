import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { restoreWorkspaceFile } from "@/lib/workspace-restore";

const bodySchema = z.object({
  path: z.string().min(1).max(4_096),
  revision: z.string().min(7).max(40),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return apiError(new Error("Invalid request body."), 400);
  }

  try {
    return Response.json(
      await restoreWorkspaceFile(workspaceId, user.id, body),
    );
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}
