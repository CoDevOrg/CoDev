import { apiError, getApiUser } from "@/lib/api";
import { acceptSharedChatInvite, SharedChatError } from "@/lib/shared-chat";

type Context = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { token } = await params;
    const roomId = await acceptSharedChatInvite(token, user.id);
    return Response.json({ roomId });
  } catch (error) {
    if (error instanceof SharedChatError) {
      return apiError(error, error.status);
    }
    console.error("Failed to accept a collaborative room invite.", error);
    return apiError(new Error("The room invite could not be accepted."), 500);
  }
}
