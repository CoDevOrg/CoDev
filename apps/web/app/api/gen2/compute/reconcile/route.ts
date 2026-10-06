import { runtimeEnvironment } from "@/lib/platform/runtime-environment";
import { timingSafeEqual } from "node:crypto";
import { gen2OwnerBudgetReportSchema } from "@codev/contracts";
import { recordOwnerBudget } from "@/lib/gen2/owner-budget-report";
import { readJson, errorResponse } from "@/lib/http/api-route";

import { reconcileComputeQuota } from "@/lib/gen2/compute-reconcile";
import { reconcileArmWorkspaceOperations } from "@/lib/gen2/runtime-operations";

export const maxDuration = 300;

function authorized(request: Request) {
  const secret = runtimeEnvironment().CRON_SECRET;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer /, "");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(supplied);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return false;
  }
  return true;
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  const [compute] = await Promise.all([
    reconcileComputeQuota(),
    reconcileArmWorkspaceOperations(),
  ]);
  return Response.json(compute);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  try {
    const recorded = await recordOwnerBudget(
      await readJson(request, gen2OwnerBudgetReportSchema),
    );
    return Response.json({ recorded });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
