import { withUser } from "@/lib/http/api-route";
import { createGen2Chat, listGen2Chats } from "@/lib/gen2/chats";

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json({ chats: await listGen2Chats(workspaceId, user.id) }),
  { errorStatus: 500 },
);

export const POST = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    const chat = await createGen2Chat(workspaceId, user.id);
    return Response.json({ chat }, { status: 201 });
  },
  { errorStatus: 500 },
);
