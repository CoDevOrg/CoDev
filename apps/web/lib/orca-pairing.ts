import { z } from "zod";

/**
 * Pure helpers for the Orca runtime readiness contract. Each workspace's
 * dedicated `orca serve --serve-json` process prints one
 * `orca_server_ready` JSON line at startup; `codev-orchestrator` captures it
 * and returns it verbatim as `IdeSession.ready` from
 * `POST/GET /v1/sandboxes/{workspaceId}/ide` (see
 * `services/orchestrator/src/backend/orca.rs`). See third_party/orca/UPSTREAM.md.
 */

export const orcaReadySchema = z.object({
  type: z.literal("orca_server_ready"),
  schemaVersion: z.number().int(),
  runtimeId: z.string().min(1),
  boundEndpoint: z.string().min(1).nullable(),
  advertisedEndpoint: z.string().min(1).nullable(),
  pairing: z.union([
    z.object({
      available: z.literal(true),
      url: z.string().min(1),
      endpoint: z.string().min(1),
      deviceId: z.string().min(1),
      webClientUrl: z.string().nullable(),
      scope: z.enum(["runtime", "mobile"]),
    }),
    z.object({
      available: z.literal(false),
      reason: z.string(),
      guidance: z.string(),
    }),
  ]),
});

export type OrcaReady = z.infer<typeof orcaReadySchema>;

export interface OrcaPairing {
  runtimeId: string;
  endpoint: string;
  /** base64url pairing offer accepted by the web client's #pairing= fragment. */
  pairingCode: string;
}

/**
 * Extract the base64url pairing code from an `orca://pair?code=...` deep link.
 */
export function extractPairingCode(pairingUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(pairingUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "orca:" || parsed.hostname !== "pair") {
    return null;
  }
  const code = parsed.searchParams.get("code");
  if (code && code.trim() !== "") {
    return code.trim();
  }
  return null;
}

/**
 * Parse the orchestrator's captured `orca_server_ready` JSON (the `ready`
 * field of `IdeSession` in services/orchestrator/src/model.rs) into the
 * connection info the browser needs. Throws with an operator-actionable
 * message when the runtime cannot pair.
 *
 * `expectedWorkspaceId` re-validates that the endpoint this workspace's
 * dedicated `orca serve` process advertised is actually scoped to its own
 * `/w/<workspaceId>/` Caddy route (the address the orchestrator told it to
 * advertise via `--serve-pairing-address`, see `services/orchestrator/src/backend/orca.rs`),
 * rather than trusting an unexpected self-reported endpoint verbatim — the
 * same "never confirm on a mismatch" defense already used for the DOM
 * automation path in `apps/web/components/orca-workspace.tsx`.
 */
export function parseOrcaReady(
  ready: unknown,
  expectedWorkspaceId: string,
): OrcaPairing {
  const parsed = orcaReadySchema.parse(ready);
  if (!parsed.pairing.available) {
    throw new Error(
      `Orca runtime pairing is unavailable (${parsed.pairing.reason}). ${parsed.pairing.guidance}`,
    );
  }
  if (parsed.pairing.scope !== "runtime") {
    throw new Error(
      "The Orca runtime minted a non-runtime pairing offer; restart orca serve without --mobile-pairing.",
    );
  }
  if (!parsed.pairing.endpoint.includes(`/w/${expectedWorkspaceId}`)) {
    throw new Error(
      "The Orca runtime advertised an endpoint outside this workspace's own path-scoped route.",
    );
  }
  const pairingCode = extractPairingCode(parsed.pairing.url);
  if (!pairingCode) {
    throw new Error("The Orca pairing URL could not be parsed.");
  }
  return {
    runtimeId: parsed.runtimeId,
    endpoint: parsed.pairing.endpoint,
    pairingCode,
  };
}

const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Root for per-workspace clones on the Orca host. */
export const ORCA_WORKSPACES_ROOT = "/srv/codev/workspaces";

export function orcaWorkspacePath(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error("Invalid workspace id.");
  }
  return `${ORCA_WORKSPACES_ROOT}/${workspaceId}`;
}

/**
 * Root for per-user personal Orca runtimes. These back the signed-in
 * member's own settings surface, so they never clone a repository and are
 * kept off {@link ORCA_WORKSPACES_ROOT} to keep personal runtimes from
 * colliding with a workspace directory.
 */
export const ORCA_PERSONAL_ROOT = "/srv/codev/personal";

export function orcaPersonalPath(userId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(userId)) {
    throw new Error("Invalid user id.");
  }
  return `${ORCA_PERSONAL_ROOT}/${userId}`;
}
