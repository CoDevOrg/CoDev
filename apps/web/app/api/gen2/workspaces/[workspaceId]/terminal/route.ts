import {
  gen2TerminalActionSchema,
  gen2TerminalSessionIdSchema,
} from "@codev/contracts";

import { ApiError, readJson, withUser } from "@/lib/http/api-route";
import {
  closeGen2Terminal,
  pollGen2Terminal,
  resizeGen2Terminal,
  sendGen2TerminalInput,
  startGen2Terminal,
} from "@/lib/gen2/terminals";

/** A poll parks for up to 20s in the guest before it answers. */
export const maxDuration = 60;

type Params = { workspaceId: string };

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2TerminalActionSchema);
    switch (input.action) {
      case "start": {
        const sessionId = await startGen2Terminal(workspaceId, user.id, input);
        return Response.json({ sessionId }, { status: 201 });
      }
      case "input":
        await sendGen2TerminalInput(
          workspaceId,
          user.id,
          input.sessionId,
          input.data,
        );
        return new Response(null, { status: 204 });
      case "resize":
        await resizeGen2Terminal(workspaceId, user.id, input.sessionId, input);
        return new Response(null, { status: 204 });
      case "poll":
        return Response.json(
          await pollGen2Terminal(
            workspaceId,
            user.id,
            input.sessionId,
            input.after,
          ),
        );
    }
  },
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const sessionId = gen2TerminalSessionIdSchema.safeParse(
      new URL(request.url).searchParams.get("sessionId"),
    );
    if (!sessionId.success) {
      throw new ApiError("A valid terminal session is required.", 400);
    }
    await closeGen2Terminal(workspaceId, user.id, sessionId.data);
    return new Response(null, { status: 204 });
  },
  { errorStatus: 502 },
);
