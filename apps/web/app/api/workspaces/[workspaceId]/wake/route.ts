import { withWorkspace } from "@/lib/http/api-route";
import { requestHostWake, requestHostWakeFor } from "@/lib/runtime/host";
import {
  ensureRuntimeHostAssignment,
  isRuntimeHostPoolEnabled,
} from "@/lib/runtime/runtime-host-pool";

/**
 * Wake only the shared Azure runtime host. This route intentionally does not
 * check the workspace quota, resolve member credentials, clone a repository,
 * or start an Orca session. The dashboard can call it on strong navigation
 * intent so VM startup overlaps the workspace page navigation.
 *
 * One wake attempt is deliberate: if Azure reports that the host is stopping,
 * waiting here would turn a cheap intent signal into a multi-second request.
 * The workspace page remains responsible for polling the full session path.
 */
export const POST = withWorkspace(
  "view",
  async ({ workspaceId }) => {
    if (isRuntimeHostPoolEnabled()) {
      const assignment = await ensureRuntimeHostAssignment(workspaceId);
      if (!assignment) {
        return Response.json(
          { state: "starting" },
          {
            status: 202,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      const state = await requestHostWakeFor(assignment.providerId, 1);
      return Response.json(
        { state },
        {
          status: state === "running" ? 200 : 202,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const state = await requestHostWake(1);
    return Response.json(
      { state },
      {
        status: state === "running" ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  },
  { errorStatus: 502 },
);
