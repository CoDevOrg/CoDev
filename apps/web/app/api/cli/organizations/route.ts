import { cliAuthErrorResponse } from "@/lib/cli-auth";
import { listCliOrganizations } from "@/lib/codex-cli-auth-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return Response.json({
      organizations: await listCliOrganizations(request),
    });
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
