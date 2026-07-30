import { updatePilotSessionSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import { isPilotAdminLogin } from "@/lib/pilot-access";
import { updatePilotSession } from "@/lib/pilot";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  if (!isPilotAdminLogin(user.githubLogin)) {
    return apiError(new Error("Pilot administrator access required."), 403);
  }

  const limit = await consumeRateLimit(user.id, "pilot-session-update", 60, 60);
  if (!limit.allowed) {
    return Response.json(
      { error: "Pilot update limit reached. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const parsed = updatePilotSessionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Invalid pilot session update."), 400);
  }

  try {
    const { sessionId } = await params;
    const session = await updatePilotSession({
      sessionId,
      userId: user.id,
      ...parsed.data,
    });
    return Response.json({ session });
  } catch (error) {
    return apiError(error);
  }
}
