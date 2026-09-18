import { startOAuth } from "@/lib/providers/oauth-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return startOAuth(request, "claude");
}
