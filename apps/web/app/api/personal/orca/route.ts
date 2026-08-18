import { apiError, getApiUser } from "@/lib/api";
import { OrcaHostError, ensurePersonalOrcaSession } from "@/lib/orca-host";

export const maxDuration = 300;

/**
 * Open the signed-in member's own Orca runtime, used to render the personal
 * settings surface outside any workspace. No repository is cloned and the
 * session is keyed by the member's own id, so this never touches workspace
 * state or requires workspace membership.
 */
export async function POST() {
  const user = await getApiUser();
  if (!user) {
    return apiError(new Error("Sign in to open personal settings."), 401);
  }

  try {
    const runtime = await ensurePersonalOrcaSession(user.id);
    if (runtime.state === "host-starting") {
      return Response.json({ state: "host-starting" }, { status: 202 });
    }

    return Response.json({
      state: "ready",
      pairingCode: runtime.pairing.pairingCode,
      endpoint: runtime.pairing.endpoint,
      runtimeId: runtime.pairing.runtimeId,
      workspacePath: runtime.workspacePath,
      webClientPath: "/orca/web-index.html",
    });
  } catch (error) {
    if (error instanceof OrcaHostError) {
      return apiError(error, error.status);
    }
    return apiError(error, 500);
  }
}
