import { brainEntryKindSchema, recordBrainEntrySchema } from "@codev/contracts";
import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import { listBrainEntries, recordBrainEntry } from "@/lib/workspace-brain";

type Context = {
  params: Promise<{ workspaceId: string }>;
};

const postBodySchema = recordBrainEntrySchema.extend({
  sessionId: z.uuid().optional(),
});

function permissionStatus(error: unknown) {
  return error instanceof Error && "status" in error
    ? Number((error as { status: unknown }).status)
    : 403;
}

export async function GET(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(error, permissionStatus(error));
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || undefined;
  const kindsParam = url.searchParams
    .getAll("kind")
    .map((value) => brainEntryKindSchema.safeParse(value))
    .flatMap((result) => (result.success ? [result.data] : []));
  try {
    return Response.json({
      entries: await listBrainEntries(workspaceId, {
        limit: 60,
        ...(query ? { query } : {}),
        ...(kindsParam.length ? { kinds: kindsParam } : {}),
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(error, permissionStatus(error));
  }
  try {
    const { sessionId, ...entry } = postBodySchema.parse(await request.json());
    return Response.json(
      {
        entry: await recordBrainEntry(
          workspaceId,
          sessionId ?? null,
          user.id,
          entry,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error, 400);
  }
}
