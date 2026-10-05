import { dispatchArmWorkflow } from "@/lib/gen2/arm-workflow-bridge";
import { errorResponse } from "@/lib/http/api-route";

export async function POST(request: Request) {
  try {
    return Response.json(await dispatchArmWorkflow(request));
  } catch (error) {
    return errorResponse(error, 503);
  }
}

export const GET = POST;
