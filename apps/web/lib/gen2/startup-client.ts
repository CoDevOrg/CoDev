import { boundedJsonRequest } from "./bounded-request";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

const STARTUP_MAX_WAIT_MS = 90_000;
const STARTUP_RECHECK_MS = 60_000;
const MAX_BACKOFF_MS = 15_000;

type WorkspaceResponse = {
  workspace?: Gen2WorkspaceDetail;
  error?: string;
};

type ReadyGen2WorkspaceDetail = Gen2WorkspaceDetail & {
  status: "ready";
  sandboxId: string;
};

type StartupResult =
  | { workspace: Gen2WorkspaceDetail; error?: never }
  | {
      workspace?: never;
      error: string;
      /** The workspace owner has no active plan (HTTP 402); retrying won't help. */
      subscriptionRequired?: true;
    };

type StartupDependencies = {
  fetcher?: typeof fetch;
  pause?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  maxWaitMs?: number;
  recheckMs?: number;
};

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(attempt: number, random: () => number) {
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(attempt, 4));
  return Math.round(base * (0.8 + random() * 0.4));
}

function readyWorkspace(
  workspace: Gen2WorkspaceDetail | undefined,
): workspace is ReadyGen2WorkspaceDetail {
  return workspace?.status === "ready" && Boolean(workspace.sandboxId);
}

/**
 * Keep the workspace opening while Azure wakes its host. Each POST is bounded
 * by the server; a 503 means the host is still waking and can be retried. When
 * another member owns provisioning, poll its persisted workspace state and
 * periodically POST again so a stale startup claim can be recovered.
 */
export async function ensureGen2WorkspaceReady(
  workspaceId: string,
  dependencies: StartupDependencies = {},
): Promise<StartupResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const wait = dependencies.pause ?? pause;
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const deadline = now() + (dependencies.maxWaitMs ?? STARTUP_MAX_WAIT_MS);
  const recheckMs = dependencies.recheckMs ?? STARTUP_RECHECK_MS;
  const url = `/api/gen2/workspaces/${workspaceId}`;
  let attempt = 0;
  let lastPostAt = Number.NEGATIVE_INFINITY;
  let postNext = true;

  while (now() < deadline) {
    if (postNext) {
      lastPostAt = now();
      postNext = false;
      try {
        const { response, payload } =
          await boundedJsonRequest<WorkspaceResponse>(
            `${url}/instance`,
            { method: "POST" },
            Math.min(65_000, deadline - now()),
            fetcher,
          );
        if (readyWorkspace(payload.workspace)) {
          return { workspace: payload.workspace! };
        }
        if (payload.workspace) {
          if (payload.workspace.status === "failed") {
            return {
              error:
                payload.workspace.lastError ??
                "The Firecracker instance could not start.",
            };
          }
          if (payload.workspace.status === "deleting") {
            return { error: "This workspace is being deleted." };
          }
        }
        if (response.status === 402) {
          return {
            error:
              payload.error ??
              "An active Individual plan is required to run this workspace.",
            subscriptionRequired: true,
          };
        }
        if (!response.ok && response.status !== 503) {
          return {
            error: payload.error ?? "The machine could not start.",
          };
        }
        if (response.status === 503) {
          attempt += 1;
          postNext = true;
        }
      } catch {
        // A response can be lost after the server claims startup. The next
        // status read can join it without holding another long request open.
        attempt += 1;
      }
      if (postNext) {
        if (now() < deadline) {
          await wait(
            Math.min(
              retryDelay(attempt, random),
              Math.max(0, deadline - now()),
            ),
          );
        }
        continue;
      }
    } else {
      await wait(
        Math.min(retryDelay(attempt, random), Math.max(0, deadline - now())),
      );
      if (now() >= deadline) break;
      if (now() - lastPostAt >= recheckMs) {
        postNext = true;
        continue;
      }

      try {
        const { response, payload } =
          await boundedJsonRequest<WorkspaceResponse>(
            url,
            { method: "GET" },
            Math.min(10_000, deadline - now()),
            fetcher,
          );
        if (!response.ok) {
          if (response.status === 404 || response.status === 409) {
            return {
              error: payload.error ?? "This workspace is no longer available.",
            };
          }
          attempt += 1;
          continue;
        }
        const workspace = payload.workspace;
        if (workspace && readyWorkspace(workspace)) return { workspace };
        if (!workspace) {
          return { error: "The workspace status could not be loaded." };
        }
        if (workspace.status === "failed") {
          return {
            error:
              workspace.lastError ??
              "The Firecracker instance could not start.",
          };
        }
        if (workspace.status === "deleting") {
          return { error: "This workspace is being deleted." };
        }
        if (workspace.status === "pending" || workspace.status === "stopped") {
          postNext = true;
        } else {
          attempt += 1;
        }
      } catch {
        attempt += 1;
      }
    }
  }

  return {
    error:
      "The workspace is taking longer to reconnect. Please try again in a moment.",
  };
}
