import { gen2SupersetCreateEntryRequestSchema } from "@codev/contracts";

import { createGen2SupersetEntry } from "@/lib/gen2/superset";
import { readJson, withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2SupersetCreateEntryRequestSchema);
    return Response.json({
      entry: await createGen2SupersetEntry(workspaceId, user.id, input),
    });
  },
  { errorStatus: 502 },
);
