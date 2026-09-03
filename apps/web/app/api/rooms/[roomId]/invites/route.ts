import { apiError, getApiUser } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSharedChatInvite, SharedChatError } from "@/lib/shared-chat";

type Context = { params: Promise<{ roomId: string }> };

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const limit = await consumeRateLimit(
    user.id,
    "shared-chat-invite",
    20,
    24 * 60 * 60,
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "Invite limit reached. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  try {
    const { roomId } = await params;
    const invite = await createSharedChatInvite(roomId, user.id);
    const origin = new URL(request.url).origin;
    return Response.json(
      {
        inviteUrl: `${origin}/room-invites/${invite.token}`,
        expiresAt: invite.expiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SharedChatError) {
      return apiError(error, error.status);
    }
    console.error("Failed to create a collaborative room invite.", error);
    return apiError(new Error("The room invite could not be created."), 500);
  }
}
