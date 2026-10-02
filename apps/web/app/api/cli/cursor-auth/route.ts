import { cliAuthErrorResponse } from "@/lib/auth/cli-auth";
import { saveCursorCliAuth } from "@/lib/providers/cursor-cli-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json({
      status: "connected",
      ...(await saveCursorCliAuth(request)),
    });
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
