import {
  readStoredSessionImportState,
  storeSessionImport,
} from "@/lib/agents/session-import-storage";
import {
  decodeSessionCapsuleTransport,
  MAX_SESSION_CAPSULE_TRANSPORT_BYTES,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
} from "@/lib/agents/session-capsule-transport";
import { ApiError, withWorkspace } from "@/lib/http/api-route";

export const runtime = "nodejs";

async function readCapsuleBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new ApiError("Invalid session capsule content length.");
    }
    if (Number(declaredLength) > MAX_SESSION_CAPSULE_TRANSPORT_BYTES) {
      throw new ApiError("The session capsule exceeds the 32 MiB limit.", 413);
    }
  }

  if (!request.body) throw new ApiError("The session capsule is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SESSION_CAPSULE_TRANSPORT_BYTES) {
        await reader.cancel();
        throw new ApiError(
          "The session capsule exceeds the 32 MiB limit.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) throw new ApiError("The session capsule is empty.");
  if (declaredLength !== null && bytes !== Number(declaredLength)) {
    throw new ApiError("The session capsule content length does not match.");
  }
  const artifact = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    artifact.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return artifact;
}

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) => {
    const mediaType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE) {
      throw new ApiError("Unsupported session capsule media type.", 415);
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError("An Idempotency-Key header is required.");
    }

    const artifact = await readCapsuleBody(request);
    const { capsule } = decodeSessionCapsuleTransport(artifact);
    const stored = await storeSessionImport({
      workspaceId,
      importedBy: user.id,
      idempotencyKey,
      artifact,
    });
    const state = await readStoredSessionImportState({
      workspaceId,
      importId: stored.importId,
      importedBy: user.id,
    });

    return Response.json(
      {
        importId: stored.importId,
        created: stored.created,
        status: state.status,
        source: {
          provider: capsule.source.provider,
          externalSessionId: capsule.source.externalSessionId,
        },
        transcript: { entryCount: capsule.transcript.length },
        handoff: capsule.handoff,
        repository: {
          ...capsule.repository,
          status: state.repositoryStatus,
          worktreeId: state.worktreeId,
        },
        actions: {
          restoreRepository:
            state.status === "stored" || state.status === "restoring",
          acceptTranscriptOnly:
            state.status === "restoring" &&
            (state.repositoryStatus === "conflicted" ||
              state.repositoryStatus === "unavailable"),
        },
      },
      {
        status: stored.created ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  },
);
