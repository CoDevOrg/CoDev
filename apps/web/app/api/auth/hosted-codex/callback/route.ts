import { finishHostedCodexConnection } from "@/lib/hosted-codex-subscription-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return finishHostedCodexConnection(request);
}
