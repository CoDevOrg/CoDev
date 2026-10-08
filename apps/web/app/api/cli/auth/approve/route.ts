import {
  approveCliDeviceAuthorization,
  cliAuthErrorResponse,
} from "@/lib/auth/cli-auth";
import { getCurrentAppUser } from "@/lib/auth/identity";

import { forwardedRequest } from "@/lib/http/forwarded-request";
import { hasSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  request = forwardedRequest(request);
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return Response.json(
      { error: "JSON content type is required." },
      { status: 415 },
    );
  }
  try {
    const user = await getCurrentAppUser();
    if (!user)
      return Response.json({ error: "Sign in first." }, { status: 401 });
    const input = (await request.json()) as { userCode?: unknown };
    if (typeof input.userCode !== "string") {
      return Response.json({ error: "CLI code is required." }, { status: 400 });
    }
    await approveCliDeviceAuthorization({
      userCode: input.userCode,
      userId: user.id,
    });
    return Response.json({ status: "approved" });
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
