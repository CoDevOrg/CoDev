import { startOAuthSession } from "@/lib/oauth-route";

export async function POST(request: Request) {
  return startOAuthSession(request, "codex");
}
