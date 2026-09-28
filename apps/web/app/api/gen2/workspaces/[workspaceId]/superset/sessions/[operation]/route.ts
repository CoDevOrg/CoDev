import { z } from "zod";

import { ApiError, readJson, withUser } from "@/lib/http/api-route";
import {
  approveSupersetSession,
  cancelSupersetSession,
  createSupersetSession,
  getSupersetSession,
  getSupersetSessionEvents,
  listSupersetSessions,
  promptSupersetSession,
} from "@/lib/gen2/superset-sessions";

type Params = { workspaceId: string; operation: string };
const requestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  before: z
    .object({ epoch: z.string().min(1), seq: z.number().int().nonnegative() })
    .optional(),
  text: z.string().trim().min(1).max(100_000).optional(),
  commandId: z.string().uuid().optional(),
  turnId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  decision: z
    .object({
      type: z.enum([
        "accept",
        "accept_for_session",
        "decline",
        "cancel",
        "option",
      ]),
      optionId: z.string().optional(),
    })
    .optional(),
});

export const POST = withUser<Params>(
  async ({ request, user, params }) => {
    const { workspaceId, operation } = params;
    const input = await readJson(request, requestSchema);
    if (operation === "list")
      return Response.json({
        sessions: await listSupersetSessions(workspaceId, user.id),
      });
    if (operation === "create")
      return Response.json(await createSupersetSession(workspaceId, user.id), {
        status: 201,
      });
    if (!input.sessionId) throw new ApiError("Session ID is required.");
    if (operation === "get")
      return Response.json(
        await getSupersetSession(workspaceId, user.id, input.sessionId),
      );
    if (operation === "events")
      return Response.json(
        await getSupersetSessionEvents(
          workspaceId,
          user.id,
          input.sessionId,
          input.before,
        ),
      );
    if (!input.commandId) throw new ApiError("Command ID is required.");
    if (operation === "prompt" && input.text)
      return Response.json(
        await promptSupersetSession(
          workspaceId,
          user.id,
          input.sessionId,
          input.text,
          input.commandId,
        ),
      );
    if (operation === "cancel" && input.turnId)
      return Response.json(
        await cancelSupersetSession(
          workspaceId,
          user.id,
          input.sessionId,
          input.turnId,
          input.commandId,
        ),
      );
    if (operation === "approve" && input.approvalId && input.decision)
      return Response.json(
        await approveSupersetSession(
          workspaceId,
          user.id,
          input.sessionId,
          input.approvalId,
          input.decision,
          input.commandId,
        ),
      );
    throw new ApiError("Invalid session operation.");
  },
  { errorStatus: 500, sanitizeUnexpectedErrors: true },
);
