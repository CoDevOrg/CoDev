import type {
  Gen2ComputeSwitchResponse,
  Gen2WorkspaceDetail,
} from "@codev/contracts";
import { boundedJsonRequest } from "./bounded-request";

export type SwitchProgress = "stopping" | "starting" | "stopped";

export type SwitchOptions = {
  targetWorkspaceId: string;
  activeWorkspaceId: string;
  idempotencyKey?: string;
  onProgress?: (progress: SwitchProgress) => void;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  maxStopWaitMs?: number;
};

export type SwitchResult =
  | { success: true; operationId: string | null }
  | { success: false; error: string };

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_STOP_WAIT_MS = 120_000;

export async function switchActiveWorkspace(
  options: SwitchOptions,
): Promise<SwitchResult> {
  const {
    targetWorkspaceId,
    activeWorkspaceId,
    idempotencyKey = crypto.randomUUID(),
    onProgress,
    signal,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxStopWaitMs = DEFAULT_MAX_STOP_WAIT_MS,
  } = options;

  try {
    const { response, payload } = await boundedJsonRequest<
      Gen2ComputeSwitchResponse & { error?: string }
    >(
      "/api/gen2/compute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: targetWorkspaceId,
          activeWorkspaceId,
          idempotencyKey,
        }),
        signal: signal ?? null,
      },
      15_000,
    );

    if (!response.ok || !payload.accepted) {
      return {
        success: false,
        error: payload.error ?? "Failed to switch active workspace.",
      };
    }

    if (!payload.stoppingWorkspaceId) {
      return { success: true, operationId: payload.operationId };
    }

    onProgress?.("stopping");
    const stoppingId = payload.stoppingWorkspaceId;
    const deadline = Date.now() + maxStopWaitMs;

    while (Date.now() < deadline && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (signal?.aborted) break;

      const { response: statusRes, payload: statusPayload } =
        await boundedJsonRequest<{ workspace?: Gen2WorkspaceDetail }>(
          `/api/gen2/workspaces/${stoppingId}`,
          { method: "GET", cache: "no-store", signal: signal ?? null },
          10_000,
        );

      if (statusRes.ok && statusPayload.workspace) {
        const ws = statusPayload.workspace;
        const isStopped =
          ws.status === "stopped" ||
          ws.status === "pending" ||
          ws.runtimeStatus === "stopped";
        if (isStopped) {
          onProgress?.("stopped");
          break;
        }
      }
    }

    if (signal?.aborted) {
      return { success: false, error: "Workspace switch was cancelled." };
    }

    onProgress?.("starting");
    const repeatKey = crypto.randomUUID();
    const { response: repeatRes, payload: repeatPayload } =
      await boundedJsonRequest<Gen2ComputeSwitchResponse & { error?: string }>(
        "/api/gen2/compute",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: targetWorkspaceId,
            activeWorkspaceId,
            idempotencyKey: repeatKey,
          }),
          signal: signal ?? null,
        },
        15_000,
      );

    if (!repeatRes.ok || !repeatPayload.accepted) {
      return {
        success: false,
        error:
          repeatPayload.error ??
          "Failed to start target workspace after stopping source.",
      };
    }

    return { success: true, operationId: repeatPayload.operationId };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while switching workspaces.",
    };
  }
}
