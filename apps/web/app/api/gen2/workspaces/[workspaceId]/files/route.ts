import {
  gen2FileReadRequestSchema,
  gen2FileUploadRequestSchema,
  gen2FileWriteRequestSchema,
} from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import {
  listGen2Files,
  readGen2File,
  searchGen2Files,
  uploadGen2File,
  writeGen2File,
} from "@/lib/gen2/workbench";

/** `find` and `git grep` run in the guest with a 30s timeout of their own. */
export const maxDuration = 60;

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const query = new URL(request.url).searchParams.get("query")?.trim();
    if (query) {
      return Response.json({
        matches: await searchGen2Files(workspaceId, user.id, query),
      });
    }
    return Response.json({ files: await listGen2Files(workspaceId, user.id) });
  },
  { errorStatus: 502 },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const { path } = await readJson(request, gen2FileReadRequestSchema);
    return Response.json({
      file: await readGen2File(workspaceId, user.id, path),
    });
  },
  { errorStatus: 502 },
);

/** Upload: a create, so it will not overwrite unless asked to. */
export const PATCH = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2FileUploadRequestSchema);
    return Response.json(await uploadGen2File(workspaceId, user.id, input));
  },
  { errorStatus: 502 },
);

export const PUT = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2FileWriteRequestSchema);
    return Response.json(await writeGen2File(workspaceId, user.id, input));
  },
  { errorStatus: 502 },
);
