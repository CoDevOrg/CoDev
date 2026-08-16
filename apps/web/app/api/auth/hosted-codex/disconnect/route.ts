import { disconnectHostedCodexConnection } from "@/lib/hosted-codex-subscription-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return disconnectHostedCodexConnection(request);
}
