import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";
import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  handleSandboxTerminalSocket,
  sandboxTerminalSocketMaxPayload,
} from "@/lib/sandbox-terminal-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  let access: Awaited<ReturnType<typeof requireWorkspacePermission>>;
  try {
    access = await requireWorkspacePermission(workspaceId, user.id, "terminal");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    await ensureWorkspaceRuntimeReady(
      workspaceId,
      user.id,
      access.permissions.terminalWrite ? "coSteer" : "review",
    );
    return await experimental_upgradeWebSocket(
      (socket) =>
        void handleSandboxTerminalSocket(workspaceId, socket as WebSocket, {
          userId: z.uuid().parse(user.id),
          userName:
            typeof user.name === "string" && user.name.trim().length > 0
              ? user.name.trim()
              : typeof user.email === "string" && user.email.length > 0
                ? user.email
                : "CoDev user",
          avatarUrl: z
            .url()
            .nullable()
            .parse(user.image ?? null),
          readOnly: !access.permissions.terminalWrite,
        }),
      { maxPayload: sandboxTerminalSocketMaxPayload },
    );
  } catch {
    return apiError(
      new Error("The terminal service is temporarily unavailable."),
      503,
    );
  }
}
