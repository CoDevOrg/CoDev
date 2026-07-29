import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  closeSandboxTerminal,
  pollSandboxTerminal,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
} from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";

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

async function authorizedWorkspace(workspaceId: string) {
  const user = await getApiUser();
  if (!user) return { response: apiError(new Error("Authentication required."), 401) };
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return { response: apiError(new Error("Workspace not found."), 404) };
  if (!workspace.canTerminal) {
    return { response: apiError(new Error("Terminal capability is required."), 403) };
  }
  return { workspace };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const authorization = await authorizedWorkspace(workspaceId);
  if ("response" in authorization) return authorization.response;

  try {
    const input = actionSchema.parse(await request.json());
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
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const authorization = await authorizedWorkspace(workspaceId);
  if ("response" in authorization) return authorization.response;

  try {
    const sessionId = sessionIdSchema.parse(
      new URL(request.url).searchParams.get("sessionId"),
    );
    await closeSandboxTerminal(workspaceId, sessionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
