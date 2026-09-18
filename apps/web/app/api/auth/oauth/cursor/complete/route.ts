import { completeCursorApiKey } from "@/lib/providers/oauth-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return completeCursorApiKey(request);
}
