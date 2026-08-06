import { completeManualOAuth } from "@/lib/oauth-route";

export async function POST(request: Request) {
  return completeManualOAuth(request, "claude");
}
