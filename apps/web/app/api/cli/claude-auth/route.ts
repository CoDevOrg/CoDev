import { cliAuthErrorResponse } from "@/lib/cli-auth";
import { saveClaudeCliAuth } from "@/lib/claude-cli-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json({
      status: "connected",
      ...(await saveClaudeCliAuth(request)),
    });
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
