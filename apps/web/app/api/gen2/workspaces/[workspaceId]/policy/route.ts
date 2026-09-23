import { gen2AgentExecutionPolicyUpdateSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import {
  getGen2AgentExecutionPolicy,
  updateGen2AgentExecutionPolicy,
} from "@/lib/gen2/workspace-policy";

type Params = { workspaceId: string };

export const GET = withUser<Params>(async ({ user, params: { workspaceId } }) =>
  Response.json({
    policy: await getGen2AgentExecutionPolicy(workspaceId, user.id),
  }),
);

export const PUT = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const policy = await readJson(
      request,
      gen2AgentExecutionPolicyUpdateSchema,
    );
    return Response.json({
      policy: await updateGen2AgentExecutionPolicy({
        workspaceId,
        userId: user.id,
        policy,
      }),
    });
  },
);
