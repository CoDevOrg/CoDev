import { withUser, readJson } from "@/lib/http/api-route";
import { saveGen2AssistantReply } from "@/lib/gen2/chats";
import { gen2ChatAppendRequestSchema } from "@codev/contracts";

type Params = { workspaceId: string; chatId: string };

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId, chatId } }) => {
    const input = await readJson(request, gen2ChatAppendRequestSchema);
    const message = await saveGen2AssistantReply({
      workspaceId,
      chatId,
      userId: user.id,
      body: input.body,
    });
    return Response.json({ message });
  },
  { errorStatus: 500 },
);
