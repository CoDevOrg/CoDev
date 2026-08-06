import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  deleteUserEnvironmentVariable,
  updateUserEnvironmentVariable,
} from "@/lib/user-environment";

const paramsSchema = z.object({
  variableId: z.uuid(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ variableId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { variableId } = paramsSchema.parse(await context.params);
    const variable = await updateUserEnvironmentVariable(
      user.id,
      variableId,
      await request.json().catch(() => null),
    );
    return Response.json({ variable });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ variableId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { variableId } = paramsSchema.parse(await context.params);
    await deleteUserEnvironmentVariable(user.id, variableId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
