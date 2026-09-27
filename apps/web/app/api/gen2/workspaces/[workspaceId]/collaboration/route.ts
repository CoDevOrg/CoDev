import { experimental_upgradeWebSocket } from "@vercel/functions";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  handleGen2CollaborationSocket,
  gen2CollaborationSocketMaxPayload,
} from "@/lib/gen2/collaboration-socket";
import { requireGen2Member } from "@/lib/gen2/workspaces";
import { apiError } from "@/lib/http/api";
import { withUser } from "@/lib/http/api-route";
import { getDatabase } from "@/lib/platform/database";

type Params = { workspaceId: string };

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Authenticated browser-only transport for a Gen 2 shared document. */
export const GET = withUser<Params>(
  async ({ user: sessionUser, params: { workspaceId } }) => {
    const [membership, user] = await Promise.all([
      requireGen2Member(workspaceId, sessionUser.id),
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
    if (!user) return apiError(new Error("Workspace not found."), 404);
    try {
      return await experimental_upgradeWebSocket(
        (socket) =>
          handleGen2CollaborationSocket(workspaceId, socket, user, {
            canEdit: membership.role !== "viewer",
          }),
        { maxPayload: gen2CollaborationSocketMaxPayload },
      );
    } catch {
      return apiError(
        new Error("Realtime collaboration is temporarily unavailable."),
        503,
      );
    }
  },
  { errorStatus: 503 },
);
