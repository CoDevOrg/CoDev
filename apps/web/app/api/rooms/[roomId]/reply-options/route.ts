import { apiError, getApiUser } from "@/lib/http/api";
import { getSharedChatRoom } from "@/lib/chat/shared-chat";
import { roomReplyOptions } from "@/lib/chat/shared-chat-reply";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { roomId } = await params;
  if (!(await getSharedChatRoom(roomId, user.id)))
    return apiError(new Error("Room not found."), 404);
  return Response.json(
    { options: await roomReplyOptions(user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
