import { startOAuth } from "@/lib/oauth-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return startOAuth(request, "claude");
}
