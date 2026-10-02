import { withUser } from "@/lib/http/api-route";
import { requireGen2Member } from "@/lib/gen2/workspaces";
import { getSandbox, touchSandbox } from "@/lib/runtime/orchestrator-sandbox";
import { OrchestratorError } from "@/lib/runtime/orchestrator-request";

type Params = { workspaceId: string };

function connectionRoute(active: boolean) {
  return withUser<Params>(
    async ({ user, params: { workspaceId } }) => {
      await requireGen2Member(workspaceId, user.id);
      try {
        // Never wake or provision here. Reconnection is an explicit instance POST.
        const sandbox = await (active
          ? touchSandbox(workspaceId, 8_000)
          : getSandbox(workspaceId, 8_000));
        return Response.json(
          { connected: sandbox.status === "ready" },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        if (error instanceof OrchestratorError && error.status === 404) {
          return Response.json(
            { connected: false },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        throw error;
      }
    },
    { errorStatus: 503 },
  );
}

export const GET = connectionRoute(false);
export const POST = connectionRoute(true);
