import "server-only";

import type { RawData, WebSocket } from "ws";
import { z } from "zod";

import { createAgentEvent, type AgentEvent } from "@codev/shared-types";

import {
  closeSandboxTerminal,
  pollSandboxTerminal,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
} from "@/lib/orchestrator";
import { appendWorkspaceStateEvent } from "@/lib/workspace-state";

const dimensionsSchema = z.object({
  rows: z.number().int().min(1).max(500),
  columns: z.number().int().min(1).max(500),
});

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), ...dimensionsSchema.shape }),
  z.object({ type: z.literal("input"), data: z.string().max(64 * 1_024) }),
  z.object({ type: z.literal("resize"), ...dimensionsSchema.shape }),
]);

function parseMessage(data: RawData) {
  const value = Buffer.isBuffer(data)
    ? data.toString("utf8")
    : Array.isArray(data)
      ? Buffer.concat(data).toString("utf8")
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : String(data);
  return messageSchema.parse(JSON.parse(value));
}

function send(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export async function handleSandboxTerminalSocket(
  workspaceId: string,
  socket: WebSocket,
  actor: SandboxTerminalActor,
) {
  let sessionId: string | null = null;
  let closed = false;
  let polling = false;
  let after = 0;

  const writeError = async (message: string) => {
    const event = terminalEvent(workspaceId, actor, "TERMINAL_EXEC_END", {
      status: "failed",
      error: message,
    });
    await appendWorkspaceStateEvent(event);
    send(socket, { type: "error", message, event });
  };

  const poll = async () => {
    if (!sessionId || polling || closed) return;
    polling = true;
    try {
      while (sessionId && !closed) {
        const result = await pollSandboxTerminal(workspaceId, sessionId, after);
        for (const chunk of result.chunks) {
          after = Math.max(after, chunk.sequence);
          send(socket, { type: "data", data: chunk.data });
        }
        if (result.exited) {
          const event = terminalEvent(workspaceId, actor, "TERMINAL_EXEC_END", {
            exitCode: result.exitCode ?? undefined,
            status: result.exitCode === 0 ? "completed" : "failed",
          });
          await appendWorkspaceStateEvent(event);
          send(socket, {
            type: "exit",
            exitCode: result.exitCode,
            event,
          });
          break;
        }
      }
    } catch (error) {
      if (!closed) {
        await writeError(
          error instanceof Error
            ? error.message
            : "Terminal stream interrupted.",
        );
      }
    } finally {
      polling = false;
    }
  };

  socket.on("message", (data) => {
    void (async () => {
      try {
        const message = parseMessage(data);
        if (message.type === "start") {
          if (sessionId) return;
          sessionId = await startSandboxTerminal(workspaceId, message);
          after = 0;
          const event = terminalEvent(
            workspaceId,
            actor,
            "TERMINAL_EXEC_START",
            {
              command: "$SHELL",
              status: "started",
              metadata: {
                rows: message.rows,
                columns: message.columns,
              },
            },
          );
          await appendWorkspaceStateEvent(event);
          send(socket, {
            type: "ready",
            sessionId,
            event,
          });
          void poll();
        } else if (message.type === "input") {
          if (!sessionId) throw new Error("Terminal is not started.");
          if (actor.readOnly) {
            send(socket, {
              type: "error",
              message: "This terminal is read-only for your workspace role.",
            });
            return;
          }
          await sendSandboxTerminalInput(workspaceId, sessionId, message.data);
        } else {
          if (!sessionId) throw new Error("Terminal is not started.");
          if (actor.readOnly) return;
          await resizeSandboxTerminal(workspaceId, sessionId, message);
        }
      } catch (error) {
        await writeError(
          error instanceof Error ? error.message : "Invalid terminal message.",
        );
      }
    })();
  });

  socket.once("close", () => {
    closed = true;
    if (sessionId)
      void closeSandboxTerminal(workspaceId, sessionId).catch(() => undefined);
  });
  socket.once("error", () => {
    closed = true;
  });
}

export const sandboxTerminalSocketMaxPayload = 128 * 1_024;

export type SandboxTerminalActor = {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  readOnly?: boolean;
};

function terminalEvent(
  workspaceId: string,
  actor: SandboxTerminalActor,
  type: Extract<
    AgentEvent["type"],
    "TERMINAL_EXEC_START" | "TERMINAL_EXEC_END"
  >,
  payload: AgentEvent["payload"],
) {
  return createAgentEvent({
    workspaceId,
    sessionId: null,
    turnId: null,
    actor: {
      userId: z.uuid().parse(actor.userId),
      userName: actor.userName,
      avatarUrl: z.url().nullable().parse(actor.avatarUrl),
    },
    modelProvider: "custom",
    modelName: "firecracker-pty",
    type,
    payload,
  });
}
