import "server-only";
import { timingSafeEqual } from "node:crypto";
import { gen2ArmWorkflowParamsSchema } from "@codev/contracts";
import { readJson } from "../http/api-route";
import { Gen2LifecycleError } from "./errors";
import { nativeArmWorkflowBinding } from "./arm-workflow-binding";

export async function dispatchArmWorkflow(request: Request) {
  const secret = process.env.CRON_SECRET;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  if (
    !secret ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new Gen2LifecycleError("Unauthorized.", 401);
  const binding = nativeArmWorkflowBinding();
  if (request.method === "POST") {
    const params = await readJson(request, gen2ArmWorkflowParamsSchema);
    await binding.create({ id: params.operationId, params });
    return { queued: true };
  }
  const operationId = new URL(request.url).searchParams.get("id");
  if (
    !operationId ||
    !gen2ArmWorkflowParamsSchema.shape.operationId.safeParse(operationId)
      .success
  )
    throw new Gen2LifecycleError("Invalid workflow ID.", 400);
  return (await binding.get(operationId)).status();
}
