import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";
import { collaborationPathSchema } from "@codev/contracts";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import {
  listWorkspacePresenceEntries,
  recordOrcaActiveFile,
} from "@/lib/collaboration-server";
import { getDatabase } from "@/lib/database";

const activeFileSchema = z.object({ path: collaborationPathSchema });

async function getAuthorizedUser(workspaceId: string) {
  const sessionUser = await getApiUser();
  if (!sessionUser?.id) throw new Error("Authentication required.");
  await requireWorkspacePermission(workspaceId, sessionUser.id, "view");
  const [user] = await getDatabase()
    .select({
      id: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, sessionUser.id))
    .limit(1);
  if (!user) throw new Error("Workspace member was not found.");
  return user;
}

function statusFor(error: unknown) {
  return error instanceof Error && "status" in error
    ? Number(error.status)
    : 400;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await context.params;
    await getAuthorizedUser(workspaceId);
    const presence = await listWorkspacePresenceEntries(workspaceId);
    return Response.json({
      members: presence.map(({ user, path }) => ({ user, path })),
    });
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await context.params;
    const user = await getAuthorizedUser(workspaceId);
    const { path } = activeFileSchema.parse(await request.json());
    await recordOrcaActiveFile(workspaceId, user, path);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}
