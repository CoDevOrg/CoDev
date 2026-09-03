import { conversationImportPreviewInputSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import {
  ChatGptShareFetchError,
  previewChatGptShare,
} from "@/lib/conversation-import/chatgpt-share-fetch";
import { consumeRateLimit } from "@/lib/rate-limit";

const PREVIEW_LIMIT = 20;
const PREVIEW_WINDOW_SECONDS = 10 * 60;

function fetchErrorResponse(error: ChatGptShareFetchError) {
  const status =
    error.code === "unavailable"
      ? 404
      : error.code === "response_too_large"
        ? 413
        : error.code === "timed_out"
          ? 504
          : error.code === "upstream_error" ||
              error.code === "invalid_content_type"
            ? 502
            : 400;
  return Response.json({ error: error.message, code: error.code }, { status });
}

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const limit = await consumeRateLimit(
    user.id,
    "conversation-import-preview",
    PREVIEW_LIMIT,
    PREVIEW_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return Response.json(
      {
        error: "Conversation preview limit reached. Please try again later.",
        code: "rate_limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const input = conversationImportPreviewInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return Response.json(
      {
        error: "A valid ChatGPT share URL is required.",
        code: "invalid_request",
      },
      { status: 400 },
    );
  }

  try {
    const conversation = await previewChatGptShare(input.data.url);
    return Response.json(
      { conversation },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ChatGptShareFetchError) {
      return fetchErrorResponse(error);
    }
    return apiError(
      new Error("The conversation preview could not be created."),
      500,
    );
  }
}
