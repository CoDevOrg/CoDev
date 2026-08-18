import { cliAuthErrorResponse } from "@/lib/cli-auth";
import { saveCodexCliAuthCache } from "@/lib/codex-cli-auth-cache";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json({
      status: "connected",
      ...(await saveCodexCliAuthCache(request)),
    });
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
