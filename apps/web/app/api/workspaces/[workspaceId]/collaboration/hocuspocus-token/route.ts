import { createHmac } from "node:crypto";

import { withWorkspace } from "@/lib/http/api-route";
import { recordWorkspaceHeartbeat } from "@/lib/runtime/heartbeat";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";
import { getWorkspaceRuntime } from "@/lib/workspaces/workspaces";

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

export const GET = withWorkspace(
  "view",
  async ({ user, workspaceId, access }) => {
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
  },
  { errorStatus: 503 },
);
