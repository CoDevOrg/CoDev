import { ZodError } from "zod";

import { sharedChatMessageInputSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { postSharedChatMessage, SharedChatError } from "@/lib/shared-chat";

type Context = { params: Promise<{ roomId: string }> };

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { roomId } = await params;
  const limit = await consumeRateLimit(
    user.id,
    "shared-chat-message",
    60,
    10 * 60,
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "Message limit reached. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  try {
    const input = sharedChatMessageInputSchema.parse(
      await request.json().catch(() => null),
    );
    const message = await postSharedChatMessage({
      roomId,
      userId: user.id,
      authorName: user.name?.trim() || user.githubLogin || "You",
      body: input.body,
    });
    return Response.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(new Error("Enter a message before sending."), 400);
    }
    if (error instanceof SharedChatError) {
      return apiError(error, error.status);
    }
    console.error("Failed to post a collaborative room message.", error);
    return apiError(new Error("The message could not be sent."), 500);
  }
}
