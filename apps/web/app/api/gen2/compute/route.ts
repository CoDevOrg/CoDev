import { withUser } from "@/lib/http/api-route";
import {
  MONTHLY_COMPUTE_LIMIT_MS,
  computeMonth,
  ownerHasUnlimitedCompute,
  usedComputeMs,
} from "@/lib/gen2/compute-quota";

export const GET = withUser(async ({ user }) => {
  const now = new Date();
  const unlimited = await ownerHasUnlimitedCompute(user.id);
  return Response.json({
    minutesUsed: Math.ceil((await usedComputeMs(user.id, now)) / 60_000),
    minutesLimit: unlimited ? null : MONTHLY_COMPUTE_LIMIT_MS / 60_000,
    unlimited,
    resetsAt: computeMonth(now).end.toISOString(),
  });
});
