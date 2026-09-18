import { postChannelMessageSchema } from "@codev/contracts";

import { withWorkspace } from "@/lib/api-route";
import { dispatchAgentMention } from "@/lib/team-chat-agent";
import {
  listChannelMessages,
  markChannelRead,
  postChannelMessage,
} from "@/lib/team-chat";

type Params = { workspaceId: string; channelId: string };

export const GET = withWorkspace<Params>(
  "view",
  async ({ request, user, workspaceId, params: { channelId } }) => {
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
  },
);

export const POST = withWorkspace<Params>(
  "view",
  async ({ request, user, workspaceId, params: { channelId } }) => {
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
  },
);
