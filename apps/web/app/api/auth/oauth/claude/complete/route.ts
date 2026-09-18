import { completeManualOAuth } from "@/lib/providers/oauth-route";

export async function POST(request: Request) {
  return completeManualOAuth(request, "claude");
}
