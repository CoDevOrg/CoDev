import { createPilotSessionSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import { isPilotAdminLogin } from "@/lib/pilot-access";
import { createPilotSession } from "@/lib/pilot";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  if (!isPilotAdminLogin(user.githubLogin)) {
    return apiError(new Error("Pilot administrator access required."), 403);
  }

  const limit = await consumeRateLimit(user.id, "pilot-session-create", 20, 60);
  if (!limit.allowed) {
    return Response.json(
      { error: "Pilot session limit reached. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const parsed = createPilotSessionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Choose a valid workspace."), 400);
  }

  try {
    const session = await createPilotSession({
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
