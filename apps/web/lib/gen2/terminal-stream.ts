import "server-only";

import { z } from "zod";

import {
  gen2TerminalSessionIdSchema,
  gen2SupersetWorktreeIdSchema,
} from "@codev/contracts";

import { gen2TerminalAccess } from "./terminal-access";
import { gen2TerminalBackend } from "./terminals";
import type { ServerWebSocket } from "../platform/websocket";

/**
 * Marwan's terminal socket (320c5f27). The workspace shell was rebuilt after
 * that change; this is the same stream.
 *
 * The session itself is still started, sized and closed over the ordinary
 * terminal route. The socket only replaces the per-keystroke HTTP round trip:
 * input is authorized against current membership, and the server holds one upstream
 * poll open and pushes output the moment the shell prints it. Each membership
 * check also reads the guest route, so a keystroke or poll costs one database
 * round trip. Closing the socket never closes the shell; the browser
 * reconnects with the cursor of the last output it saw and picks up exactly
 * where it stopped. An open socket does not count as workspace activity —
 * only the input and resize it forwards.
 */

export const gen2TerminalStreamQuerySchema = z.object({
  sessionId: gen2TerminalSessionIdSchema,
  worktreeId: gen2SupersetWorktreeIdSchema.default("main"),
  after: z.coerce.number().int().nonnegative().default(0),
});

export const gen2TerminalStreamMaxPayload = 128 * 1_024;

const dimension = z.number().int().min(1).max(500);
const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string().max(64 * 1_024) }),
  z.object({ type: z.literal("resize"), rows: dimension, columns: dimension }),
]);

/** An upstream that answers at once (not parked) must not spin this loop. */
const MIN_EMPTY_POLL_MS = 300;
const EMPTY_POLL_PAUSE_MS = 60;

function decode(data: string) {
  return messageSchema.parse(JSON.parse(data));
}

function send(socket: ServerWebSocket, message: Record<string, unknown>) {
  if (socket.readyState === socket.openState) {
    socket.send(JSON.stringify(message));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The terminal stream was interrupted.";
}

export async function handleGen2TerminalSocket(
  socket: ServerWebSocket,
  input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    worktreeId: string;
    after: number;
  },
) {
  const backend = gen2TerminalBackend(input.workspaceId, input.worktreeId);
  let closed = false;
  let cursor = input.after;
  let pendingInput = "";
  let flushing = false;

  const stop = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    try {
      socket.close(code, reason);
    } catch {
      // Already closing.
    }
  };

  const fail = (error: unknown) => {
    if (closed) return;
    send(socket, { type: "error", message: errorMessage(error) });
    stop(1011, "terminal stream error");
  };

  /** Input reaches the shell in the order it was typed, one request at a time. */
  const flushInput = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (pendingInput && !closed) {
        const data = pendingInput;
        pendingInput = "";
        const access = await gen2TerminalAccess(
          input.workspaceId,
          input.userId,
        );
        if (closed) return;
        await backend.input(input.sessionId, data, access);
      }
    } catch (error) {
      fail(error);
    } finally {
      flushing = false;
    }
  };

  socket.onMessage(({ data, isBinary }) => {
    if (closed) return;
    let message: z.infer<typeof messageSchema>;
    try {
      if (isBinary || data === null) throw new Error("Expected text message.");
      message = decode(data);
    } catch {
      send(socket, { type: "error", message: "Invalid terminal message." });
      return;
    }
    if (message.type === "input") {
      pendingInput += message.data;
      void flushInput();
    } else {
      void (async () => {
        const access = await gen2TerminalAccess(
          input.workspaceId,
          input.userId,
        );
        if (!closed) await backend.resize(input.sessionId, message, access);
      })().catch((error) => fail(error));
    }
  });
  socket.onceClose(() => {
    closed = true;
  });
  socket.onceError(() => {
    closed = true;
  });

  send(socket, { type: "ready", after: cursor });

  try {
    let access = await gen2TerminalAccess(input.workspaceId, input.userId);
    while (!closed) {
      const requestedAt = Date.now();
      const result = await backend.poll(input.sessionId, cursor, access);
      if (closed) return;
      // The check before delivery also authorizes and routes the next poll.
      access = await gen2TerminalAccess(input.workspaceId, input.userId);
      if (closed) return;
      const data = result.chunks.map((chunk) => chunk.data).join("");
      cursor = result.nextSequence;
      if (data) send(socket, { type: "data", data, next: cursor });
      if (result.exited) {
        send(socket, {
          type: "exit",
          exitCode: result.exitCode,
          next: cursor,
        });
        stop();
        return;
      }
      if (!data && Date.now() - requestedAt < MIN_EMPTY_POLL_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, EMPTY_POLL_PAUSE_MS),
        );
      }
    }
  } catch (error) {
    fail(error);
  }
}
