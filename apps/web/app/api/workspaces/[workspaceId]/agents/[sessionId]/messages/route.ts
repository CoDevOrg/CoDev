import {
  createCoordinationMessage,
  listCoordinationMessages,
} from "@/lib/coordination/agent-coordination";
import { withWorkspace } from "@/lib/http/api-route";

type Params = { workspaceId: string; sessionId: string };

export const GET = withWorkspace<Params>(
  "view",
  async ({ workspaceId, params: { sessionId } }) =>
    Response.json({
      messages: await listCoordinationMessages(workspaceId, sessionId),
    }),
);

export const POST = withWorkspace<Params>(
  "coSteer",
  async ({ request, workspaceId, params: { sessionId } }) => {
    const message = await createCoordinationMessage(
      workspaceId,
      sessionId,
      await request.json(),
    );
    return Response.json({ message }, { status: 201 });
  },
);
