import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { withWorkspace } from "@/lib/api-route";
import {
  handleSandboxTerminalSocket,
  sandboxTerminalSocketMaxPayload,
} from "@/lib/sandbox-terminal-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withWorkspace(
  "terminal",
  async ({ user, workspaceId, access }) => {
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
  },
);
