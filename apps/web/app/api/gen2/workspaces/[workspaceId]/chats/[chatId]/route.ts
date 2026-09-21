import { withUser } from "@/lib/http/api-route";
import { getGen2ChatDetail } from "@/lib/gen2/chats";

type Params = { workspaceId: string; chatId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId, chatId } }) =>
    Response.json({
      chat: await getGen2ChatDetail(workspaceId, chatId, user.id),
    }),
  { errorStatus: 500 },
);
