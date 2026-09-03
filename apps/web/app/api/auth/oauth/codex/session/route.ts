import { startOAuthSession } from "@/lib/oauth-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return startOAuthSession(request, "codex");
}
