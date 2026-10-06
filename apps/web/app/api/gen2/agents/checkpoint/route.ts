import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { checkpointGen2SupersetAgentCredentials } from "@/lib/gen2/superset-agent-runtime";

const requestSchema = z.object({ workspaceId: z.string().uuid() });

export async function POST(request: Request) {
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
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return new Response(null, { status: 400 });
  return Response.json(
    await checkpointGen2SupersetAgentCredentials(parsed.data.workspaceId),
  );
}
