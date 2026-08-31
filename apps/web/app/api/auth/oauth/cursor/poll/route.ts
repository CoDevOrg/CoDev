import { pollDeviceOAuth } from "@/lib/oauth-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return pollDeviceOAuth(request, "cursor");
}
