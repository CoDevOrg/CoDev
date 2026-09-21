import "server-only";

import { fakeGuestEnabled } from "./fake-guest";

import { z } from "zod";

import { requestHostWake } from "./host";
import {
  OrchestratorError,
  orchestratorRequest,
  orchestratorRequestAt,
} from "./orchestrator-request";

const HOST_START_TIMEOUT_MS = 4 * 60 * 1_000;

export async function checkOrchestratorConnection(timeoutMs = 4_000) {
  const response = await orchestratorRequest(
    "GET",
    "/healthz",
    undefined,
    timeoutMs,
  );
  return parseHealth(response);
}

export async function checkOrchestratorConnectionAt(
  endpoint: string,
  timeoutMs = 4_000,
) {
  const response = await orchestratorRequestAt(
    endpoint,
    "GET",
    "/healthz",
    undefined,
    timeoutMs,
  );
  return parseHealth(response);
}

async function parseHealth(response: Response) {
  return z
    .object({
      status: z.literal("ok"),
      service: z.literal("codev-orchestrator"),
    })
    .parse(await response.json());
}

/**
 * Wait until the Firecracker host is running *and* its orchestrator answers.
 *
 * The host stops itself after ten minutes idle, so the first call after any
 * quiet period lands on a stopped instance. Starting it takes roughly ten
 * seconds before the orchestrator is even up, and longer before it serves --
 * far longer than a single provision attempt is willing to wait. Callers that
 * skip this see "Firecracker host unavailable" on the first click and success
 * on the second, which is the whole of that bug.
 *
 * `requestHostWake` absorbs transient EC2 failures itself and reports the host
 * as starting, so a capacity refusal or a mid-restart instance costs another
 * turn of this loop rather than failing the action outright.
 */
export async function ensureHostReady(timeoutMs = HOST_START_TIMEOUT_MS) {
  // The local stand-in has no host to wake.
  if (fakeGuestEnabled()) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await requestHostWake().catch(() => "starting" as const);
    if (state === "running") {
      try {
        await waitForOrchestrator(Math.min(45_000, deadline - Date.now()));
        return;
      } catch (error) {
        // A freshly woken host reports unhealthy on purpose until its setup
        // finishes, which can outlast one health window; keep waiting.
        if (Date.now() >= deadline) throw error;
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new OrchestratorError(
    "The workspace runtime is still starting. Try again in a moment.",
    503,
  );
}

export async function waitForOrchestrator(timeoutMs = 45_000) {
  return waitForOrchestratorAt(undefined, timeoutMs);
}

export async function waitForOrchestratorAt(
  endpoint: string | undefined,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const remaining = Math.min(4_000, deadline - Date.now());
      if (endpoint) {
        await checkOrchestratorConnectionAt(endpoint, remaining);
      } else {
        await checkOrchestratorConnection(remaining);
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }

  throw new Error(
    `The Firecracker host started but its orchestrator did not become healthy: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`,
  );
}
