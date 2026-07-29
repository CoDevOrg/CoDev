import { experimental_upgradeWebSocket } from "@vercel/functions";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { apiError, getApiUser } from "@/lib/api";
import {
  collaborationSocketMaxPayload,
  handleCollaborationSocket,
} from "@/lib/collaboration-server";
import { getDatabase } from "@/lib/database";
import { getWorkspaceForMember } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const sessionUser = await getApiUser();
  if (!sessionUser?.id) {
    return apiError(new Error("Authentication required."), 401);
  }

  const { workspaceId } = await params;
  const [workspace, user] = await Promise.all([
    getWorkspaceForMember(workspaceId, sessionUser.id),
    getDatabase()
      .select({
        id: schema.users.id,
        login: schema.users.login,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
      })
      .from(schema.users)
      .where(eq(schema.users.id, sessionUser.id))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (!workspace || !user) {
    return apiError(new Error("Workspace not found."), 404);
  }

  try {
    return await experimental_upgradeWebSocket(
      (socket) => handleCollaborationSocket(workspaceId, socket, user),
      { maxPayload: collaborationSocketMaxPayload },
    );
  } catch {
    return apiError(
      new Error("Realtime collaboration is temporarily unavailable."),
      503,
    );
  }
}
