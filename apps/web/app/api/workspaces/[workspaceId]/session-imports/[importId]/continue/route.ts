import { z } from "zod";

import { continueStoredSessionImport } from "@/lib/agents/session-import-continuation";
import { AgentCapacityError } from "@/lib/agents/agent-capacity";
import { SessionImportLifecycleError } from "@/lib/agents/session-import-lifecycle";
import {
  restoreStoredSessionImport,
  SessionImportRestoreError,
} from "@/lib/agents/session-import-restore";
import { SessionImportStorageError } from "@/lib/agents/session-import-storage";
import { ApiError, readJson, withWorkspace } from "@/lib/http/api-route";

export const runtime = "nodejs";

const bodySchema = z.object({ chatOnly: z.boolean().optional() }).strict();

export const POST = withWorkspace<{
  workspaceId: string;
  importId: string;
}>("coSteer", async ({ request, user, workspaceId, params }) => {
  const body = await readJson(request, bodySchema);
  const continuationInput = {
    workspaceId,
    importId: params.importId,
    importedBy: user.id,
    ...(body.chatOnly ? { chatOnly: true } : {}),
  };
  try {
    let result: Awaited<ReturnType<typeof continueStoredSessionImport>>;
    try {
      result = await continueStoredSessionImport(continuationInput);
    } catch (error) {
      if (
        !(error instanceof SessionImportLifecycleError) ||
        error.code !== "session_import_not_ready"
      ) {
        throw error;
      }

      const restoration = await restoreStoredSessionImport(continuationInput);
      if (restoration.status !== "ready") {
        const message =
          restoration.repositoryStatus === "conflicted"
            ? "CoDev could not apply the imported repository changes. Review the repository issue below and retry."
            : "CoDev could not find the imported repository state. Review the repository issue below and retry.";
        throw new SessionImportRestoreError(
          message,
          409,
          "session_import_repository_needs_attention",
        );
      }
      result = await continueStoredSessionImport(continuationInput);
    }
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof AgentCapacityError) {
      throw new ApiError(error.message, 409);
    }
    if (
      (error instanceof SessionImportLifecycleError ||
        error instanceof SessionImportRestoreError ||
        error instanceof SessionImportStorageError) &&
      error.status < 500
    ) {
      throw error;
    }
    throw new ApiError(
      "The CoDev session could not be created. Please try again.",
      503,
    );
  }
});
