import { sessionProviderSchema } from "@codev/contracts";

import {
  importSessionSource,
  SessionSourceImportError,
} from "@/lib/agents/session-source-import";
import {
  SessionImportStorageError,
  storeSessionImport,
} from "@/lib/agents/session-import-storage";
import { logSessionImportStorageFailure } from "@/lib/agents/session-import-diagnostics";
import { ApiError, withWorkspace } from "@/lib/http/api-route";

export const runtime = "nodejs";

const MAX_SOURCE_BYTES = 5 * 1_024 * 1_024;

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) => {
    const provider = sessionProviderSchema.safeParse(
      request.headers.get("x-session-provider"),
    );
    if (!provider.success)
      throw new ApiError(
        "Choose Codex, Claude, or Cursor as the source provider.",
      );
    if (
      request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/x-ndjson"
    ) {
      throw new ApiError(
        "Choose a provider session file in JSONL format.",
        415,
      );
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey)
      throw new ApiError("An Idempotency-Key header is required.");
    const declaredLength = request.headers.get("content-length");
    if (
      declaredLength &&
      (!/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > MAX_SOURCE_BYTES)
    ) {
      throw new ApiError("The source session exceeds the 5 MiB limit.", 413);
    }
    if (!request.body) throw new ApiError("Choose a nonempty session file.");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_SOURCE_BYTES) {
          await reader.cancel();
          throw new ApiError(
            "The source session exceeds the 5 MiB limit.",
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (declaredLength && Number(declaredLength) !== length)
      throw new ApiError("The source session content length does not match.");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let artifact: Uint8Array;
    try {
      artifact = importSessionSource(provider.data, bytes);
    } catch (error) {
      if (error instanceof SessionSourceImportError)
        throw new ApiError(error.message, error.status);
      throw error;
    }
    let stored: Awaited<ReturnType<typeof storeSessionImport>>;
    try {
      stored = await storeSessionImport({
        workspaceId,
        importedBy: user.id,
        idempotencyKey,
        artifact,
      });
    } catch (error) {
      if (error instanceof SessionImportStorageError && error.status < 500)
        throw error;
      logSessionImportStorageFailure(request, "provider_source", error);
      throw new ApiError(
        "The session could not be saved. Please try again or contact your workspace administrator.",
        503,
      );
    }
    return Response.json(
      { importId: stored.importId, created: stored.created },
      {
        status: stored.created ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  },
);
