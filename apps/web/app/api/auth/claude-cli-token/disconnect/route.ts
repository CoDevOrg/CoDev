import { disconnectClaudeCliTokenConnection } from "@/lib/providers/claude-cli-token-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return disconnectClaudeCliTokenConnection(request);
}
