import "server-only";

import { readServerEnvironment } from "@codev/config";
import { z } from "zod";

import { OrchestratorError } from "./orchestrator-error";
export { OrchestratorError } from "./orchestrator-error";
import { workspaceRuntimeTarget } from "./workspace-runtime-target";

import { fakeGuestEnabled, handleFakeGuestRequest } from "./fake-guest";

const errorSchema = z.object({
  error: z.string(),
  conflictPaths: z.array(z.string()).optional(),
  currentRevision: z.string().optional(),
});

/**
 * Every orchestrator call, over the bearer-authenticated direct HTTPS path.
 *
 * There used to be a second transport here: SigV4-signed requests to an API
 * Gateway + Lambda proxy, which was how apps/web reached the EC2 host. That
 * proxy imposed a hard, non-configurable 29-second integration timeout, and
 * an authenticated Codex turn can run for 900 seconds -- which is the entire
 * reason the direct path was built as a bypass in the first place. The Azure
 * host has no such tier, so the bypass became the only path, and with AWS
 * retired the signed one is gone along with its SigV4 machinery.
 */
export async function orchestratorRequest(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 70_000,
) {
  return orchestratorDirectRequest(method, path, body, timeoutMs);
}

/** Use a scheduler-resolved host address for control-plane health checks. */
export async function orchestratorRequestAt(
  endpoint: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 70_000,
) {
  return orchestratorDirectRequest(method, path, body, timeoutMs, endpoint);
}

/** The orchestrator's bearer-authenticated HTTPS endpoint, via Caddy on the
 * host (see ORCHESTRATOR_DIRECT_URL). */
async function orchestratorDirectRequest(
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  endpointOverride?: string,
) {
  // A local stand-in for the Azure guest, so the workspace can be exercised
  // without infrastructure. Gated on an env var that is never set in
  // production, and it declines any path it does not model so an unmodelled
  // call still fails loudly instead of quietly succeeding.
  const faked = fakeGuestEnabled()
    ? handleFakeGuestRequest(method, path, body)
    : null;
  if (faked) return assertOrchestratorResponse(faked);

  const workspaceRoute = path.match(
    /^\/v1\/sandboxes\/([^/?]+)(\/(?:files|git|pty|terminals|codex-execs|superset|superset-agents)(?:\/|\?|$).*)$/,
  );
  if (workspaceRoute && !endpointOverride) {
    const target = await workspaceRuntimeTarget(workspaceRoute[1]!);
    if (target) {
      const { armWorkspaceRequest } = await import("./arm-workspace-request");
      return assertOrchestratorResponse(
        await armWorkspaceRequest(
          target,
          method,
          `/v1${workspaceRoute[2]}`,
          body,
          timeoutMs,
        ),
      );
    }
  }

  const environment = readServerEnvironment();
  const endpoint = environment.ORCHESTRATOR_DIRECT_URL;
  const secret = environment.ORCHESTRATOR_DIRECT_SECRET;
  if (!endpoint || !secret) {
    throw new Error(
      "ORCHESTRATOR_DIRECT_URL/ORCHESTRATOR_DIRECT_SECRET are not configured.",
    );
  }
  const targetEndpoint = endpointOverride ?? endpoint;
  // `new URL(path, base)` treats a leading-slash path as origin-relative,
  // which would silently drop the direct endpoint's own path prefix — join
  // as plain strings instead.
  const url = `${targetEndpoint.replace(/\/+$/, "")}${path}`;
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
      ...(encodedBody === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(encodedBody === undefined ? {} : { body: encodedBody }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return assertOrchestratorResponse(response);
}

/**
 * Turns a non-2xx orchestrator reply into an `OrchestratorError` carrying the
 * guest's own message and status. Shared with the local stand-in so a faked
 * 409 behaves exactly like a real one -- otherwise the double would be
 * kinder than the thing it stands in for, and hide conflict handling.
 */
async function assertOrchestratorResponse(response: Response) {
  if (response.ok) return response;
  const payload = errorSchema.safeParse(
    await response
      .clone()
      .json()
      .catch(() => null),
  );
  throw new OrchestratorError(
    payload.success
      ? payload.data.error
      : `Sandbox service returned HTTP ${response.status}.`,
    response.status,
    payload.success ? (payload.data.conflictPaths ?? []) : [],
    payload.success ? payload.data.currentRevision : undefined,
  );
}

/**
 * Kept as its own name because its callers pass timeouts measured in minutes
 * -- an authenticated Codex turn can run for 900 seconds -- even though it
 * now reaches the same transport as everything else.
 */
export async function codexExecRequest(
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
) {
  return orchestratorDirectRequest(method, path, body, timeoutMs);
}

export async function claudeSetupRequest(
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
) {
  return codexExecRequest(method, path, body, timeoutMs);
}
