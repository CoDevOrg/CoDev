import { designPartnerFeedbackInputSchema } from "@codev/contracts";
import { schema } from "@codev/db";
import { eq } from "drizzle-orm";

import { apiError, getApiUser } from "@/lib/api";
import { getDatabase } from "@/lib/database";
import {
  createFeedbackGitHubIssue,
  feedbackGitHubConfigured,
} from "@/lib/feedback-github";
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

  const release = process.env.VERCEL_GIT_COMMIT_SHA ?? "development";
  const [feedback] = await getDatabase()
    .insert(schema.designPartnerFeedback)
    .values({
      userId: user.id,
      workspaceId: parsed.data.workspaceId,
      category: parsed.data.category,
      rating: parsed.data.rating,
      message: parsed.data.message,
      page: parsed.data.page,
      release,
    })
    .returning({ id: schema.designPartnerFeedback.id });
  if (!feedback)
    return apiError(new Error("Feedback could not be saved."), 500);

  let issueUrl: string | null = null;
  let issueNumber: number | null = null;
  let issueError: string | null = null;

  if (feedbackGitHubConfigured()) {
    try {
      const issue = await createFeedbackGitHubIssue({
        feedbackId: feedback.id,
        category: parsed.data.category,
        rating: parsed.data.rating,
        message: parsed.data.message,
        page: parsed.data.page,
        workspaceId: parsed.data.workspaceId,
        release,
        user: {
          id: user.id,
          ...(user.name !== undefined ? { name: user.name } : {}),
          ...(user.email !== undefined ? { email: user.email } : {}),
          ...(user.githubLogin !== undefined
            ? { githubLogin: user.githubLogin }
            : {}),
        },
      });
      if (issue) {
        issueUrl = issue.htmlUrl;
        issueNumber = issue.number;
        await getDatabase()
          .update(schema.designPartnerFeedback)
          .set({ status: "filed" })
          .where(eq(schema.designPartnerFeedback.id, feedback.id));
      }
    } catch (error) {
      issueError =
        error instanceof Error
          ? error.message
          : "GitHub issue could not be created.";
      logEvent("error", "design_partner.feedback_issue_failed", {
        feedbackId: feedback.id,
        userId: user.id,
        error: issueError,
      });
    }
  } else {
    issueError =
      "FEEDBACK_GITHUB_TOKEN is not configured, so no GitHub issue was opened.";
    logEvent("warn", "design_partner.feedback_issue_skipped", {
      feedbackId: feedback.id,
      userId: user.id,
    });
  }

  logEvent("info", "design_partner.feedback_submitted", {
    feedbackId: feedback.id,
    userId: user.id,
    category: parsed.data.category,
    rating: parsed.data.rating,
    hasWorkspace: Boolean(parsed.data.workspaceId),
    issueNumber,
  });

  return Response.json(
    {
      feedbackId: feedback.id,
      issueUrl,
      issueNumber,
      ...(issueError && !issueUrl ? { warning: issueError } : {}),
    },
    { status: 201 },
  );
}
