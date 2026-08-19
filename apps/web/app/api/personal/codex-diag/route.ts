import { apiError, getApiUser } from "@/lib/api";
import { resolveAgentCredential } from "@/lib/credentials";
import { getWorkspaceForMember } from "@/lib/workspaces";

export async function GET(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return apiError(new Error("workspaceId query param is required."), 400);
  }
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);

  try {
    const credential = await resolveAgentCredential(
      user.id,
      workspaceId,
      "openai",
    );
    if (
      credential.authType !== "HOSTED_CODEX_SUBSCRIPTION" ||
      !credential.codexAuthCacheJson
    ) {
      return Response.json({ authType: credential.authType });
    }
    const authCacheJson = credential.codexAuthCacheJson;
    const byteLength = Buffer.byteLength(authCacheJson, "utf8");
    let parseOk = false;
    let isObject = false;
    let topLevelKeys: string[] = [];
    try {
      const parsed = JSON.parse(authCacheJson) as unknown;
      parseOk = true;
      isObject =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
      if (isObject) {
        topLevelKeys = Object.keys(parsed as Record<string, unknown>);
      }
    } catch {
      parseOk = false;
    }
    return Response.json({
      authType: credential.authType,
      byteLength,
      under128kb: byteLength <= 128 * 1024,
      parseOk,
      isObject,
      topLevelKeys,
      valid: byteLength <= 128 * 1024 && parseOk && isObject,
    });
  } catch (error) {
    return apiError(error);
  }
}
