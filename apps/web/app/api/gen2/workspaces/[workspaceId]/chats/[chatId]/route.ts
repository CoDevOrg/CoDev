import { readJson, withUser } from "@/lib/http/api-route";
import {
  getGen2ChatDetail,
  updateGen2ChatDefaultProvider,
} from "@/lib/gen2/chats";
import { gen2ChatProviderUpdateRequestSchema } from "@codev/contracts";

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
    const input = await readJson(request, gen2ChatProviderUpdateRequestSchema);
    return Response.json({
      chat: await updateGen2ChatDefaultProvider({
        workspaceId,
        chatId,
        userId: user.id,
        defaultProvider: input.defaultProvider,
      }),
    });
  },
  { errorStatus: 500 },
);
