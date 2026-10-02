import { withUser } from "@/lib/http/api-route";
import {
  MONTHLY_COMPUTE_LIMIT_MS,
  computeMonth,
  usedComputeMs,
} from "@/lib/gen2/compute-quota";

export const GET = withUser(async ({ user }) => {
  const now = new Date();
  return Response.json({
    minutesUsed: Math.ceil((await usedComputeMs(user.id, now)) / 60_000),
    minutesLimit: MONTHLY_COMPUTE_LIMIT_MS / 60_000,
    resetsAt: computeMonth(now).end.toISOString(),
  });
});
