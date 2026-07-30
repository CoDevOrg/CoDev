import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { createWorkspace } from "@/lib/workspaces";
import { QuotaError, quotaResponse } from "@/lib/quotas";

const requestSchema = z.object({
  installationId: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const input = requestSchema.parse(await request.json());
    const workspace = await createWorkspace(
      user.id,
      input.installationId,
      input.repositoryId,
    );
    return Response.json(
      {
        workspace: {
          id: workspace.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof QuotaError) return quotaResponse(error);
    return apiError(error);
  }
}
