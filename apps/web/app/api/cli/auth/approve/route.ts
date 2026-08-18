import {
  approveCliDeviceAuthorization,
  cliAuthErrorResponse,
} from "@/lib/cli-auth";
import { getCurrentAppUser } from "@/lib/identity";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
