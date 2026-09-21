import { z } from "zod";

import { SessionImportLifecycleError } from "@/lib/agents/session-import-lifecycle";
import {
  restoreStoredSessionImport,
  SessionImportRestoreError,
} from "@/lib/agents/session-import-restore";
import { ApiError, readJson, withWorkspace } from "@/lib/http/api-route";

export const runtime = "nodejs";

const bodySchema = z
  .object({ transcriptOnly: z.boolean().optional() })
  .strict();

export const POST = withWorkspace<{
  workspaceId: string;
  importId: string;
}>("coSteer", async ({ request, user, workspaceId, params }) => {
  const body = await readJson(request, bodySchema);
  try {
    const result = await restoreStoredSessionImport({
      workspaceId,
      importId: params.importId,
      importedBy: user.id,
      ...(body.transcriptOnly === undefined
        ? {}
        : { transcriptOnly: body.transcriptOnly }),
    });
    return Response.json(result);
  } catch (error) {
    if (
      (error instanceof SessionImportRestoreError ||
        error instanceof SessionImportLifecycleError) &&
      error.status < 500
    ) {
      throw error;
    }
    throw new ApiError(
      "The repository could not be restored. Please try again or contact your workspace administrator.",
      503,
    );
  }
});
