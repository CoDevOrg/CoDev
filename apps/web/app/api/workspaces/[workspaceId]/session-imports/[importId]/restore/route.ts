import { z } from "zod";

import { restoreStoredSessionImport } from "@/lib/agents/session-import-restore";
import { readJson, withWorkspace } from "@/lib/http/api-route";

export const runtime = "nodejs";

const bodySchema = z
  .object({ transcriptOnly: z.boolean().optional() })
  .strict();

export const POST = withWorkspace<{
  workspaceId: string;
  importId: string;
}>("coSteer", async ({ request, user, workspaceId, params }) => {
  const body = await readJson(request, bodySchema);
  return Response.json(
    await restoreStoredSessionImport({
      workspaceId,
      importId: params.importId,
      importedBy: user.id,
      ...(body.transcriptOnly === undefined
        ? {}
        : { transcriptOnly: body.transcriptOnly }),
    }),
  );
});
