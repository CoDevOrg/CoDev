import { z } from "zod";

import { createAgentEvent } from "@codev/shared-types";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { appendWorkspaceEvent } from "@/lib/audit";
import { appendWorkspaceStateEvent } from "@/lib/workspace-state";

const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\0") &&
      !path.split("/").some((segment) => segment === "." || segment === ".."),
    "Comment paths must stay inside the workspace.",
  );

const commentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  filePath: relativePathSchema.optional(),
  lineNumber: z.number().int().min(1).max(10_000_000).optional(),
  sessionId: z.uuid().nullable().optional(),
  turnId: z.uuid().nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const parsed = commentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Invalid review comment."), 400);
  }

  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "review");
    const avatar =
      user.image && z.url().safeParse(user.image).success ? user.image : null;
    const event = createAgentEvent({
      workspaceId,
      sessionId: parsed.data.sessionId ?? null,
      turnId: parsed.data.turnId ?? null,
      actor: {
        userId: user.id,
        userName: user.name?.trim() || user.email?.trim() || "CoDev reviewer",
        avatarUrl: avatar,
      },
      modelProvider: "custom",
      modelName: "human-review",
      type: "COMMENT_ADDED",
      payload: {
        commentText: parsed.data.body,
        ...(parsed.data.filePath ? { filePath: parsed.data.filePath } : {}),
        ...(parsed.data.lineNumber
          ? { metadata: { lineNumber: parsed.data.lineNumber } }
          : {}),
      },
    });

    await appendWorkspaceStateEvent(event);
    await appendWorkspaceEvent({
      workspaceId,
      actorId: user.id,
      type: "workspace.comment_added",
      payload: {
        commentId: event.id,
        sessionId: event.sessionId,
        filePath: event.payload.filePath ?? null,
        lineNumber: event.payload.metadata?.lineNumber ?? null,
      },
    }).catch(() => undefined);

    return Response.json({ comment: event }, { status: 201 });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}
