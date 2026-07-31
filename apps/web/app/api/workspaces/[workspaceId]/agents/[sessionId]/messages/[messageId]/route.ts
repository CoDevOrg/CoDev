import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { updateCoordinationMessageStatus } from "@/lib/agent-coordination";

const inputSchema = z.object({
  status: z.enum(["delivered", "resolved"]),
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      workspaceId: string;
      sessionId: string;
      messageId: string;
    }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId, messageId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    const input = inputSchema.parse(await request.json());
    return Response.json({
      message: await updateCoordinationMessageStatus(
        workspaceId,
        sessionId,
        messageId,
        input.status,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
