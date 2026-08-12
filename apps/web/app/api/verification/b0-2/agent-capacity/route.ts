import { z } from "zod";

import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

import { AgentCapacityError, assertAgentCapacity } from "@/lib/agent-capacity";
import { isVerificationFixtureEnabled } from "@/lib/verification-fixture";

const requestSchema = z.object({
  activeSessions: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  if (!isVerificationFixtureEnabled()) {
    return new Response(null, { status: 404 });
  }

  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json(
      { error: "The active session count must be a non-negative integer." },
      { status: 400 },
    );
  }

  try {
    assertAgentCapacity(input.data.activeSessions);
    return Response.json({ accepted: true }, { status: 201 });
  } catch (error) {
    if (error instanceof AgentCapacityError) {
      return Response.json(
        {
          code: "agent_capacity_exceeded",
          error: error.message,
          maxActiveSessions: MAX_PARALLEL_AGENT_SESSIONS,
        },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "The agent session could not be started." },
      { status: 500 },
    );
  }
}
