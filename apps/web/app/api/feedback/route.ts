import { designPartnerFeedbackInputSchema } from "@codev/contracts";
import { schema } from "@codev/db";

import { apiError, getApiUser } from "@/lib/api";
import { getDatabase } from "@/lib/database";
import { logEvent } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const limit = await consumeRateLimit(user.id, "feedback", 5, 60 * 60);
  if (!limit.allowed) {
    return Response.json(
      { error: "Feedback limit reached. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const parsed = designPartnerFeedbackInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(
      new Error("Feedback must include a category and 10–2,000 characters."),
      400,
    );
  }

  const [feedback] = await getDatabase()
    .insert(schema.designPartnerFeedback)
    .values({
      userId: user.id,
      workspaceId: parsed.data.workspaceId,
      category: parsed.data.category,
      rating: parsed.data.rating,
      message: parsed.data.message,
      page: parsed.data.page,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
    })
    .returning({ id: schema.designPartnerFeedback.id });
  if (!feedback)
    return apiError(new Error("Feedback could not be saved."), 500);

  logEvent("info", "design_partner.feedback_submitted", {
    feedbackId: feedback.id,
    userId: user.id,
    category: parsed.data.category,
    rating: parsed.data.rating,
    hasWorkspace: Boolean(parsed.data.workspaceId),
  });
  return Response.json({ feedbackId: feedback.id }, { status: 201 });
}
