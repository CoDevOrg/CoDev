import { startOAuthSession } from "@/lib/providers/oauth-route";

export async function POST(request: Request) {
  return startOAuthSession(request, "claude");
}
