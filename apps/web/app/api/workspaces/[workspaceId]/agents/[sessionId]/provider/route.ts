import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  SharedSessionError,
  selectSharedSessionProvider,
} from "@/lib/shared-session-server";

const inputSchema = z.object({
  provider: z.enum(["openai", "restricted"]),
});

type Context = {
  params: Promise<{ workspaceId: string; sessionId: string }>;
};

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
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
    return Response.json(
      await selectSharedSessionProvider(
        workspaceId,
        sessionId,
        user,
        input.provider,
      ),
    );
  } catch (error) {
    if (error instanceof SharedSessionError) {
      return apiError(error, error.status);
    }
    return apiError(error);
  }
}
