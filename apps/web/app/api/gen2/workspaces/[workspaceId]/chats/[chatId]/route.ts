import { gen2RenameChatRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import { getGen2ChatDetail, renameGen2Chat } from "@/lib/gen2/chats";

type Params = { workspaceId: string; chatId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId, chatId } }) =>
    Response.json({
      chat: await getGen2ChatDetail(workspaceId, chatId, user.id),
    }),
  { errorStatus: 500 },
);

export const PATCH = withUser<Params>(
  async ({ request, user, params: { workspaceId, chatId } }) => {
    const body = await readJson(
      request,
      gen2RenameChatRequestSchema,
      "Provide a chat title up to 80 characters.",
    );
    const chat = await renameGen2Chat(workspaceId, chatId, user.id, body.title);
    return Response.json({ chat });
  },
);
