import { releasePathClaim } from "@/lib/coordination/agent-coordination";
import { withWorkspace } from "@/lib/http/api-route";

export const DELETE = withWorkspace<{
  workspaceId: string;
  sessionId: string;
  claimId: string;
}>("coSteer", async ({ workspaceId, params: { sessionId, claimId } }) =>
  Response.json({
    claim: await releasePathClaim(workspaceId, sessionId, claimId),
  }),
);
