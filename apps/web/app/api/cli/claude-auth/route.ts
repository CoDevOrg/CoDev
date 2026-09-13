import { cliAuthErrorResponse } from "@/lib/cli-auth";
import { saveClaudeCliAuth } from "@/lib/claude-cli-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await saveClaudeCliAuth(request);
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
