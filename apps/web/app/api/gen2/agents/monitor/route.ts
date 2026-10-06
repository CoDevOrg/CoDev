import { timingSafeEqual } from "node:crypto";

import { monitorGen2SupersetAgentSessions } from "@/lib/gen2/superset-agent-runtime";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer /, "");
  if (!secret || !supplied) return new Response(null, { status: 401 });
  const expected = Buffer.from(secret);
  const received = Buffer.from(supplied);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await monitorGen2SupersetAgentSessions());
}
