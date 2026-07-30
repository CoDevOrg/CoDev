import { updatePilotFeedbackSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import { isPilotAdminLogin } from "@/lib/pilot-access";
import { updatePilotFeedback } from "@/lib/pilot";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  if (!isPilotAdminLogin(user.githubLogin)) {
    return apiError(new Error("Pilot administrator access required."), 403);
  }

  const limit = await consumeRateLimit(
    user.id,
    "pilot-feedback-update",
    60,
    60,
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "Feedback update limit reached. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const parsed = updatePilotFeedbackSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Invalid feedback status."), 400);
  }

  try {
    const { feedbackId } = await params;
    const feedback = await updatePilotFeedback({
      feedbackId,
      userId: user.id,
      status: parsed.data.status,
    });
    return Response.json({ feedback });
  } catch (error) {
    return apiError(error);
  }
}
