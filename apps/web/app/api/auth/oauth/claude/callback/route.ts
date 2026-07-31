import { finishOAuth } from "@/lib/oauth-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return finishOAuth(request, "claude");
}
