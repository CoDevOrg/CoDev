import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/auth/access";
import { withUser, withWorkspace } from "@/lib/http/api-route";
import {
  closeSandboxTerminal,
  pollSandboxTerminal,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
} from "@/lib/runtime/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";

const sessionIdSchema = z.string().regex(/^term-[0-9]+-[0-9]+$/);
const dimensionsSchema = z.object({
  rows: z.number().int().min(1).max(500),
  columns: z.number().int().min(1).max(500),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...dimensionsSchema.shape }),
  z.object({
    action: z.literal("input"),
    sessionId: sessionIdSchema,
    data: z.string().max(64 * 1_024),
  }),
  z.object({
    action: z.literal("resize"),
    sessionId: sessionIdSchema,
    ...dimensionsSchema.shape,
  }),
  z.object({
    action: z.literal("poll"),
    sessionId: sessionIdSchema,
    after: z.number().int().nonnegative(),
  }),
]);

// Typing into or resizing a terminal needs `terminalWrite`; starting and
// polling one needs `terminal`. The action decides, so it is parsed first.
export const POST = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = actionSchema.parse(await request.json());
    const access = await requireWorkspacePermission(
      workspaceId,
      user.id,
      input.action === "input" || input.action === "resize"
        ? "terminalWrite"
        : "terminal",
    );
    if (input.action !== "poll") {
      await ensureWorkspaceRuntimeReady(
        workspaceId,
        user.id,
        access.permissions.terminalWrite ? "coSteer" : "review",
      );
    }
    switch (input.action) {
      case "start": {
        const sessionId = await startSandboxTerminal(workspaceId, input);
        return Response.json({ sessionId }, { status: 201 });
      }
      case "input":
        await sendSandboxTerminalInput(
          workspaceId,
          input.sessionId,
          input.data,
        );
        return new Response(null, { status: 204 });
      case "resize":
        await resizeSandboxTerminal(workspaceId, input.sessionId, input);
        return new Response(null, { status: 204 });
      case "poll": {
        const result = await pollSandboxTerminal(
          workspaceId,
          input.sessionId,
          input.after,
        );
        return Response.json({ result });
      }
    }
  },
);

export const DELETE = withWorkspace(
  "terminalWrite",
  async ({ request, workspaceId }) => {
    const sessionId = sessionIdSchema.parse(
      new URL(request.url).searchParams.get("sessionId"),
    );
    await closeSandboxTerminal(workspaceId, sessionId);
    return new Response(null, { status: 204 });
  },
);
