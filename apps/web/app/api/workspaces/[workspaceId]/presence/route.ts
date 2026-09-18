import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";
import { collaborationPathSchema } from "@codev/contracts";

import { withWorkspace } from "@/lib/api-route";
import {
  listWorkspacePresenceEntries,
  recordOrcaActiveFile,
  recordOrcaCursor,
} from "@/lib/collaboration-server";
import { getDatabase } from "@/lib/database";

const activeFileSchema = z.object({ path: collaborationPathSchema });
const cursorSchema = activeFileSchema.extend({
  cursor: z.object({
    anchor: z.number().int().nonnegative(),
    head: z.number().int().nonnegative(),
  }),
});

async function getMember(userId: string) {
  const [user] = await getDatabase()
    .select({
      id: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error("Workspace member was not found.");
  return user;
}

export const GET = withWorkspace(
  "view",
  async ({ user: member, workspaceId }) => {
    const user = await getMember(member.id);
    const presence = await listWorkspacePresenceEntries(workspaceId);
    return Response.json({
      viewerId: user.id,
      viewer: {
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      members: presence.map(({ user, path, cursor }) => ({
        user,
        path,
        cursor,
      })),
    });
  },
);

export const POST = withWorkspace(
  "view",
  async ({ request, user: member, workspaceId }) => {
    const user = await getMember(member.id);
    const payload = await request.json();
    const cursor = cursorSchema.safeParse(payload);
    if (cursor.success) {
      await recordOrcaCursor(
        workspaceId,
        user,
        cursor.data.path,
        cursor.data.cursor,
      );
    } else {
      const { path } = activeFileSchema.parse(payload);
      await recordOrcaActiveFile(workspaceId, user, path);
    }
    return Response.json({ ok: true });
  },
);
