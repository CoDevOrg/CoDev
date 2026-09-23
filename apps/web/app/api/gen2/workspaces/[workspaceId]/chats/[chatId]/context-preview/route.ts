import { withUser } from "@/lib/http/api-route";
import { getGen2ContextPreview } from "@/lib/gen2/workspaces";

type Params = { workspaceId: string; chatId: string };

export const GET = withUser<Params>(async ({ user, params }) =>
  Response.json({
    context: await getGen2ContextPreview({
      workspaceId: params.workspaceId,
      chatId: params.chatId,
      userId: user.id,
    }),
  }),
);
