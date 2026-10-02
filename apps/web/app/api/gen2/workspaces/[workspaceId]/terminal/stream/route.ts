import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";

import { ApiError, withUser } from "@/lib/http/api-route";
import {
  gen2TerminalStreamMaxPayload,
  gen2TerminalStreamQuerySchema,
  handleGen2TerminalSocket,
} from "@/lib/gen2/terminal-stream";
import { authorizeGen2TerminalStream } from "@/lib/gen2/terminals";

export const dynamic = "force-dynamic";
/** The socket ends at the function limit; the browser reconnects and resumes. */
export const maxDuration = 300;

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    // A cookie-authenticated socket must come from this site, or another
    // page could open the victim's shell.
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      throw new ApiError("Cross-origin terminal streams are not allowed.", 403);
    }
    const query = gen2TerminalStreamQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      throw new ApiError("A valid terminal session is required.", 400);
    }
    await authorizeGen2TerminalStream(workspaceId, user.id);
    return experimental_upgradeWebSocket(
      (socket) =>
        void handleGen2TerminalSocket(socket as WebSocket, {
          workspaceId,
          userId: user.id,
          sessionId: query.data.sessionId,
          worktreeId: query.data.worktreeId,
          after: query.data.after,
        }),
      { maxPayload: gen2TerminalStreamMaxPayload },
    );
  },
  { errorStatus: 502 },
);
