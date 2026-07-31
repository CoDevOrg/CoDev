import { createHmac } from "node:crypto";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { recordWorkspaceHeartbeat } from "@/lib/heartbeat";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";
import { getWorkspaceRuntime } from "@/lib/workspaces";

const HOCUSPOCUS_TOKEN_TTL_MS = 5 * 60 * 1_000;

function signedWorkspaceToken(
  workspaceId: string,
  userId: string,
  userName: string,
  canEdit: boolean,
) {
  const secret = process.env.HOCUSPOCUS_TOKEN_SECRET;
  if (!secret) throw new Error("HOCUSPOCUS_TOKEN_SECRET is not configured.");
  const expiresAt = Date.now() + HOCUSPOCUS_TOKEN_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({
      workspaceId,
      userId,
      userName,
      canEdit,
      expiresAt,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  let access: Awaited<ReturnType<typeof requireWorkspacePermission>>;
  try {
    access = await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    if (access.permissions.edit) {
      await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    } else if ((await getWorkspaceRuntime(workspaceId))?.status === "ready") {
      await recordWorkspaceHeartbeat(workspaceId);
    }
    const userName =
      typeof user.name === "string" && user.name.trim().length > 0
        ? user.name.trim()
        : typeof user.email === "string" && user.email.length > 0
          ? user.email
          : "CoDev user";
    return Response.json(
      signedWorkspaceToken(
        workspaceId,
        user.id,
        userName,
        access.permissions.edit,
      ),
    );
  } catch (error) {
    return apiError(error, 503);
  }
}
