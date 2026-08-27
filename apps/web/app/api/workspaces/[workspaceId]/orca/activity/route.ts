import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { recordOrcaActivity } from "@/lib/orca-host";

/**
 * Keepalive for an open Orca IDE. The browser connects directly to the host's
 * Caddy endpoint, so this is the only way the orchestrator learns that a
 * session is still in use. Both the IDE session reaper and the host's idle
 * shutdown read that signal, so a workspace left open in a foreground tab
 * stays alive while one that is genuinely abandoned stops paying for compute
 * within the idle window.
 *
 * Always responds 200 rather than propagating a failure: a missed keepalive
 * must never surface as an error over a workspace somebody is working in. The
 * body reports whether the session survived, so a client whose iframe is
 * pointing at a session that no longer exists can re-provision instead of
 * sitting on a dead IDE.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUserAnyAuth(request);
  if (!user) {
    return apiError(new Error("Sign in to open this workspace."), 401);
  }
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(error, 403);
  }
  return Response.json({ session: await recordOrcaActivity(workspaceId) });
}
