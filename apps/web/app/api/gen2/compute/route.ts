import { withUser, readJson } from "@/lib/http/api-route";
import { getOwnerComputeSummary } from "@/lib/gen2/compute-summary";
import { requestFreeComputeSwitch } from "@/lib/gen2/compute-switch";
import { gen2ComputeSwitchRequestSchema } from "@codev/contracts";

export const GET = withUser(async ({ user }) =>
  Response.json(await getOwnerComputeSummary(user.id)),
);

export const POST = withUser(async ({ request, user }) => {
  const input = await readJson(request, gen2ComputeSwitchRequestSchema);
  return Response.json(
    await requestFreeComputeSwitch(
      input.workspaceId,
      input.activeWorkspaceId,
      user.id,
      input.idempotencyKey,
    ),
    { status: 202 },
  );
});
