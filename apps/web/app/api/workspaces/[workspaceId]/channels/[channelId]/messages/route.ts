import { postChannelMessageSchema } from "@codev/contracts";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import { dispatchAgentMention } from "@/lib/team-chat-agent";
import {
  listChannelMessages,
  markChannelRead,
  postChannelMessage,
  TeamChatError,
} from "@/lib/team-chat";

type Context = {
  params: Promise<{ workspaceId: string; channelId: string }>;
};

function statusFor(error: unknown, fallback = 400) {
  return error instanceof Error && "status" in error
    ? Number(error.status)
    : fallback;
}

export async function GET(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, channelId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    const limit = Number(url.searchParams.get("limit") ?? "");
    const { channel, messages } = await listChannelMessages(
      workspaceId,
      channelId,
      {
        ...(before ? { before } : {}),
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      },
    );
    // Opening a channel is what marks it read. Paging back through history is
    // not, so only a first page (no cursor) clears the badge.
    if (!before) await markChannelRead(channel.id, user.id);
    return Response.json({ channel, messages });
  } catch (error) {
    if (error instanceof TeamChatError) return apiError(error, error.status);
    return apiError(error, statusFor(error));
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, channelId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const input = postChannelMessageSchema.parse(await request.json());
    const { channel, message } = await postChannelMessage({
      workspaceId,
      channelId,
      body: input.body,
      author: { kind: "member", userId: user.id },
    });

    const agentDispatch = message.mentionsAgent
      ? await dispatchAgentMention({
          workspaceId,
          channelSlug: channel.slug,
          authorName:
            message.author?.name?.trim() ||
            message.author?.login ||
            "A teammate",
          body: message.body,
          user,
        })
      : null;

    return Response.json({ message, agentDispatch }, { status: 201 });
  } catch (error) {
    if (error instanceof TeamChatError) return apiError(error, error.status);
    return apiError(error, statusFor(error));
  }
}
