import { errorResponse } from "@/lib/http/api-route";
import { cliUpdateRequirementsForService } from "@/lib/gen2/agent-cli-fallback";

/** Internal: what the CLI updater must ship now, e.g. `claude-code=2.1.280`. */
export async function GET(request: Request) {
  try {
    return Response.json(await cliUpdateRequirementsForService(request));
  } catch (error) {
    return errorResponse(error, 503);
  }
}
