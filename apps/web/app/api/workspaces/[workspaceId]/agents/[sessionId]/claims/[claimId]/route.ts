import { releasePathClaim } from "@/lib/agent-coordination";
import { withWorkspace } from "@/lib/api-route";

export const DELETE = withWorkspace<{
  workspaceId: string;
  sessionId: string;
  claimId: string;
}>("coSteer", async ({ workspaceId, params: { sessionId, claimId } }) =>
  Response.json({
    claim: await releasePathClaim(workspaceId, sessionId, claimId),
  }),
);
