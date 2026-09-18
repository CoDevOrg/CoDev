import { z } from "zod";

import { createAgentEvent } from "@codev/shared-types";

import { readJson, withWorkspace } from "@/lib/http/api-route";
import { appendWorkspaceEvent } from "@/lib/workspaces/audit";
import { appendWorkspaceStateEvent } from "@/lib/workspaces/workspace-state";

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

export const POST = withWorkspace(
  "review",
  async ({ request, user, workspaceId }) => {
    const input = await readJson(
      request,
      commentSchema,
      "Invalid review comment.",
    );
    const avatar =
      user.image && z.url().safeParse(user.image).success ? user.image : null;
    const event = createAgentEvent({
      workspaceId,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      actor: {
        userId: user.id,
        userName: user.name?.trim() || user.email?.trim() || "CoDev reviewer",
        avatarUrl: avatar,
      },
      modelProvider: "custom",
      modelName: "human-review",
      type: "COMMENT_ADDED",
      payload: {
        commentText: input.body,
        ...(input.filePath ? { filePath: input.filePath } : {}),
        ...(input.lineNumber
          ? { metadata: { lineNumber: input.lineNumber } }
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
  },
  { errorStatus: 502 },
);
