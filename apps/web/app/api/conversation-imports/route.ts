import { conversationImportPreviewInputSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import {
  ChatGptShareFetchError,
  previewChatGptShare,
} from "@/lib/conversation-import/chatgpt-share-fetch";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSharedChatFromImportedConversation } from "@/lib/shared-chat";

function importErrorResponse(error: ChatGptShareFetchError) {
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
    "conversation-import-create",
    10,
    60 * 60,
  );
  if (!limit.allowed) {
    return Response.json(
      {
        error: "Room creation limit reached. Please try again later.",
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
    // Never trust the browser's preview payload. Fetch and validate the source
    // again immediately before committing the transcript.
    const conversation = await previewChatGptShare(input.data.url);
    const room = await createSharedChatFromImportedConversation(
      user.id,
      conversation,
    );
    return Response.json(
      {
        room: { id: room.roomId, href: `/rooms/${room.roomId}` },
        created: room.created,
      },
      {
        status: room.created ? 201 : 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof ChatGptShareFetchError) {
      return importErrorResponse(error);
    }
    return apiError(
      new Error("The collaborative room could not be created."),
      500,
    );
  }
}
