import { ZodError } from "zod";
import { start } from "workflow/api";
import { sharedChatReplyWorkflow } from "@/workflows/shared-chat-reply";
import {
  validateRoomReply,
  finishRoomReply,
  ROOM_REPLY_FAILURE,
} from "@/lib/shared-chat-reply";

import { sharedChatMessageInputSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  listSharedChatMessages,
  postSharedChatMessage,
  SharedChatError,
  getSharedChatRoom,
} from "@/lib/shared-chat";
import { publishRoomMessages } from "@/lib/shared-chat-stream";

type Context = { params: Promise<{ roomId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { roomId } = await params;
  const rawAfter = new URL(request.url).searchParams.get("after");
  const after = rawAfter === null ? -1 : Number(rawAfter);
  if (!Number.isInteger(after) || after < -1) {
    return apiError(new Error("Invalid message cursor."), 400);
  }

  try {
    const messages = await listSharedChatMessages(roomId, user.id, after);
    return Response.json(
      { messages },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof SharedChatError) {
      return apiError(error, error.status);
    }
    console.error("Failed to load collaborative room messages.", error);
    return apiError(new Error("Room messages could not be loaded."), 500);
  }
}

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
    if (input.reply) {
      if (!(await getSharedChatRoom(roomId, user.id)))
        throw new SharedChatError("Room not found.", 404);
      await validateRoomReply(user.id, input.reply);
    }
    const message = await postSharedChatMessage({
      roomId,
      userId: user.id,
      authorName: user.name?.trim() || user.githubLogin || "You",
      body: input.body,
      ...(input.reply ? { reply: input.reply } : {}),
    });
    const userMessage = "pendingReply" in message ? message.message : message;
    if ("pendingReply" in message && message.pendingReply) {
      const pending = message.pendingReply;
      // Push the user message and the pending-reply placeholder to live
      // subscribers now; the completed reply is published from
      // finishRoomReply once the model responds.
      await publishRoomMessages(roomId, [userMessage, pending.message]);
      try {
        await start(sharedChatReplyWorkflow, [pending.id]);
      } catch {
        await finishRoomReply(pending.id, ROOM_REPLY_FAILURE, true);
        pending.message.text = ROOM_REPLY_FAILURE;
        pending.message.generation!.status = "failed";
      }
      return Response.json(
        { message: userMessage, reply: pending.message },
        { status: 201 },
      );
    }
    await publishRoomMessages(roomId, [userMessage]);
    return Response.json({ message: userMessage }, { status: 201 });
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
