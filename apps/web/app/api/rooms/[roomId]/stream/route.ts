import { apiError, getApiUser } from "@/lib/api";
import {
  getSharedChatRoom,
  listSharedChatMessages,
  SharedChatError,
} from "@/lib/shared-chat";
import {
  createRoomReader,
  latestRoomStreamId,
  readRoomMessages,
} from "@/lib/shared-chat-stream";

type Context = { params: Promise<{ roomId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Block for this long on each XREAD, then emit a heartbeat and loop. Well under
// any proxy idle timeout, so the connection stays warm through quiet periods.
const BLOCK_MS = 25_000;
// Recycle the connection before a serverless platform would kill it abruptly.
// EventSource reconnects on its own and resumes from the client's cursor.
const MAX_CONNECTION_MS = 5 * 60_000;

export async function GET(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { roomId } = await params;
  const rawAfter = new URL(request.url).searchParams.get("after");
  const after = rawAfter === null ? -1 : Number(rawAfter);
  if (!Number.isInteger(after) || after < -1) {
    return apiError(new Error("Invalid message cursor."), 400);
  }

  // Fail fast with a clean status when the room is gone or Redis is not
  // configured, so the client can drop straight back to polling.
  if (!(await getSharedChatRoom(roomId, user.id))) {
    return apiError(new Error("Room not found."), 404);
  }
  const reader = createRoomReader();
  if (!reader) {
    return apiError(new Error("Realtime stream is unavailable."), 503);
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const sendMessage = (payload: string, id?: string) =>
        send(`${id ? `id: ${id}\n` : ""}data: ${payload}\n\n`);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        request.signal.removeEventListener("abort", stop);
        // Break the blocking XREAD immediately rather than waiting it out.
        reader.disconnect();
        try {
          controller.close();
        } catch {
          // Already closed by the platform; nothing more to do.
        }
      };

      const lifetime = setTimeout(stop, MAX_CONNECTION_MS);
      lifetime.unref?.();
      request.signal.addEventListener("abort", stop);

      // Tell EventSource how long to wait before reconnecting, then open.
      send("retry: 3000\n\n");

      // Capture the live cursor before backfilling so nothing published during
      // the Postgres read is missed — any overlap is deduplicated by sequence
      // on the client.
      let cursor: string;
      try {
        cursor = await latestRoomStreamId(roomId);
        const backfill = await listSharedChatMessages(roomId, user.id, after);
        for (const message of backfill) sendMessage(JSON.stringify(message));
      } catch (error) {
        if (error instanceof SharedChatError) {
          send(`event: closed\ndata: ${JSON.stringify(error.message)}\n\n`);
        }
        stop();
        return;
      }

      while (!closed) {
        try {
          const entries = await readRoomMessages(
            reader,
            roomId,
            cursor,
            BLOCK_MS,
          );
          if (!entries.length) {
            send(": ping\n\n");
            continue;
          }
          for (const entry of entries) {
            cursor = entry.id;
            sendMessage(JSON.stringify(entry.message), entry.id);
          }
        } catch {
          // A dropped Redis connection ends this stream; the client's
          // EventSource reconnects and resumes from its own cursor.
          stop();
        }
      }
    },
    cancel() {
      closed = true;
      reader.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
