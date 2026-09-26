import {
  gen2SupersetCreateEntryRequestSchema,
  gen2SupersetDeleteEntryRequestSchema,
  gen2SupersetMoveEntryRequestSchema,
} from "@codev/contracts";

import {
  createGen2SupersetEntry,
  deleteGen2SupersetEntry,
  moveGen2SupersetEntry,
} from "@/lib/gen2/superset";
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

export const PATCH = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2SupersetMoveEntryRequestSchema);
    return Response.json({
      entry: await moveGen2SupersetEntry(workspaceId, user.id, input),
    });
  },
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2SupersetDeleteEntryRequestSchema);
    return Response.json({
      path: await deleteGen2SupersetEntry(workspaceId, user.id, input),
    });
  },
  { errorStatus: 502 },
);
