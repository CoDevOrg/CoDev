import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { updateMemberCapabilities } from "@/lib/workspaces";

const requestSchema = z.object({
  canTerminal: z.boolean(),
  canMerge: z.boolean(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { workspaceId, userId } = await context.params;
    const capabilities = requestSchema.parse(await request.json());
    await updateMemberCapabilities(workspaceId, userId, user.id, capabilities);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
