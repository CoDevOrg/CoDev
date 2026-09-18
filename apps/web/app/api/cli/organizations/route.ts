import { cliAuthErrorResponse } from "@/lib/auth/cli-auth";
import { listCliOrganizations } from "@/lib/providers/codex-cli-auth-cache";

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
