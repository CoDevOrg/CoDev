import { createChannelSchema } from "@codev/contracts";

import { withWorkspace } from "@/lib/http/api-route";
import {
  createWorkspaceChannel,
  listWorkspaceChannels,
} from "@/lib/chat/team-chat";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json({
    channels: await listWorkspaceChannels(workspaceId, user.id),
  }),
);

// Reading a channel is a viewer right; adding one to the workspace's shared
// structure is not.
export const POST = withWorkspace(
  "edit",
  async ({ request, user, workspaceId }) => {
    const input = createChannelSchema.parse(await request.json());
    const channel = await createWorkspaceChannel(workspaceId, user.id, input);
    return Response.json({ channel }, { status: 201 });
  },
);
