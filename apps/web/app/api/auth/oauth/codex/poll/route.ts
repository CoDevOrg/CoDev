import { pollDeviceOAuth } from "@/lib/oauth-route";

export async function POST(request: Request) {
  return pollDeviceOAuth(request, "codex");
}
