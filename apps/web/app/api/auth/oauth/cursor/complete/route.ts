import { completeCursorApiKey } from "@/lib/oauth-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return completeCursorApiKey(request);
}
