import { createPathClaim, listPathClaims } from "@/lib/agent-coordination";
import { withWorkspace } from "@/lib/api-route";

type Params = { workspaceId: string; sessionId: string };

export const GET = withWorkspace<Params>(
  "view",
  async ({ workspaceId, params: { sessionId } }) =>
    Response.json({ claims: await listPathClaims(workspaceId, sessionId) }),
);

// A conflicting claim throws CoordinationConflictError, which carries 409.
export const POST = withWorkspace<Params>(
  "coSteer",
  async ({ request, workspaceId, params: { sessionId } }) => {
    const claim = await createPathClaim(
      workspaceId,
      sessionId,
      await request.json(),
    );
    return Response.json({ claim }, { status: 201 });
  },
);
