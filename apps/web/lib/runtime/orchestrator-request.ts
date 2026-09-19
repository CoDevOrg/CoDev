import "server-only";

import { readServerEnvironment } from "@codev/config";
import { z } from "zod";

const errorSchema = z.object({
  error: z.string(),
  conflictPaths: z.array(z.string()).optional(),
});

export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflictPaths: string[] = [],
  ) {
    super(message);
    this.name = "OrchestratorError";
  }

  /** Used by `withUser`/`withWorkspace` in place of the plain error body. */
  toResponse() {
    return Response.json(
      { error: this.message, conflictPaths: this.conflictPaths },
      { status: this.status },
    );
  }
}

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

/** The orchestrator's bearer-authenticated HTTPS endpoint, via Caddy on the
 * host (see ORCHESTRATOR_DIRECT_URL). */
async function orchestratorDirectRequest(
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
) {
  const environment = readServerEnvironment();
  const endpoint = environment.ORCHESTRATOR_DIRECT_URL;
  const secret = environment.ORCHESTRATOR_DIRECT_SECRET;
  if (!endpoint || !secret) {
    throw new Error(
      "ORCHESTRATOR_DIRECT_URL/ORCHESTRATOR_DIRECT_SECRET are not configured.",
    );
  }
  // `new URL(path, base)` treats a leading-slash path as origin-relative,
  // which would silently drop the direct endpoint's own path prefix — join
  // as plain strings instead.
  const url = `${endpoint.replace(/\/+$/, "")}${path}`;
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
  if (!response.ok) {
    const payload = errorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new OrchestratorError(
      payload.success
        ? payload.data.error
        : `Sandbox service returned HTTP ${response.status}.`,
      response.status,
      payload.success ? (payload.data.conflictPaths ?? []) : [],
    );
  }
  return response;
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
