import { gen2SessionImportConfirmRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import {
  confirmGen2SessionImport,
  discardGen2SessionImport,
} from "@/lib/gen2/session-import";

type Params = { workspaceId: string; importId: string };

/** Turns a reviewed draft into a chat. */
export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId, importId } }) => {
    const input = await readJson(
      request,
      gen2SessionImportConfirmRequestSchema,
    );
    const result = await confirmGen2SessionImport({
      workspaceId,
      userId: user.id,
      importId,
      title: input.title,
    });
    return Response.json(result, { status: 201 });
  },
  { errorStatus: 500 },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId, importId } }) => {
    await discardGen2SessionImport({ workspaceId, userId: user.id, importId });
    return new Response(null, { status: 204 });
  },
  { errorStatus: 500 },
);
