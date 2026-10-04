import { timingSafeEqual } from "node:crypto";

import { quiesceGen2SupersetWorkspace } from "@/lib/gen2/superset-agent-runtime";

export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CODEV_CONTROL_PLANE_SECRET;
  const received = request.headers
    .get("authorization")
    ?.replace(/^Bearer /, "");
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  const { workspaceId } = await context.params;
  return Response.json(await quiesceGen2SupersetWorkspace(workspaceId));
}
