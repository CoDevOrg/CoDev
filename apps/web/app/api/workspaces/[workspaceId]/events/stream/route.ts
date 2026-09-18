import { apiError } from "@/lib/http/api";
import { withWorkspace } from "@/lib/http/api-route";
import {
  createWorkspaceRealtimeReader,
  latestWorkspaceRealtimeStreamId,
  readWorkspaceRealtimeEvents,
} from "@/lib/workspaces/workspace-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLOCK_MS = 25_000;
const MAX_CONNECTION_MS = 5 * 60_000;
const STREAM_ID = /^\d+-\d+$/;

export const GET = withWorkspace("view", async ({ request, workspaceId }) => {
  const rawAfter = new URL(request.url).searchParams.get("after");
  if (rawAfter !== null && !STREAM_ID.test(rawAfter)) {
    return apiError(new Error("Invalid realtime stream cursor."), 400);
  }

  const reader = createWorkspaceRealtimeReader();
  if (!reader) {
    return apiError(new Error("Realtime stream is unavailable."), 503);
  }

  let cursor: string;
  try {
    cursor = rawAfter ?? (await latestWorkspaceRealtimeStreamId(workspaceId));
  } catch {
    reader.disconnect();
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
      const sendEvent = (id: string, event: string) =>
        send(`id: ${id}\ndata: ${event}\n\n`);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        request.signal.removeEventListener("abort", stop);
        reader.disconnect();
        try {
          controller.close();
        } catch {
          // The platform may already have closed the stream.
        }
      };

      const lifetime = setTimeout(stop, MAX_CONNECTION_MS);
      lifetime.unref?.();
      request.signal.addEventListener("abort", stop);
      send("retry: 3000\n\n");

      while (!closed) {
        try {
          const entries = await readWorkspaceRealtimeEvents(
            reader,
            workspaceId,
            cursor,
            BLOCK_MS,
          );
          if (!entries.length) {
            send(": ping\n\n");
            continue;
          }
          for (const entry of entries) {
            cursor = entry.id;
            sendEvent(entry.id, JSON.stringify(entry.event));
          }
        } catch {
          // A dropped Redis connection ends this stream. EventSource resumes
          // from the last id it received.
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
});
