import { z } from "zod";

/**
 * Pure helpers for the Orca runtime readiness contract. The Orca server
 * (`orca serve --serve-json`) prints one `orca_server_ready` JSON line at
 * startup; the host captures it to `/home/orca/orca-ready.json`, and the
 * control plane reads it over SSM. See third_party/orca/UPSTREAM.md.
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
 * Parse the captured ready line into the connection info the browser needs.
 * Throws with an operator-actionable message when the runtime cannot pair.
 */
export function parseOrcaReady(readyLine: string): OrcaPairing {
  let raw: unknown;
  try {
    raw = JSON.parse(readyLine);
  } catch {
    throw new Error("The Orca runtime readiness file is not valid JSON.");
  }
  const ready = orcaReadySchema.parse(raw);
  if (!ready.pairing.available) {
    throw new Error(
      `Orca runtime pairing is unavailable (${ready.pairing.reason}). ${ready.pairing.guidance}`,
    );
  }
  if (ready.pairing.scope !== "runtime") {
    throw new Error(
      "The Orca runtime minted a non-runtime pairing offer; restart orca-serve without --mobile-pairing.",
    );
  }
  const pairingCode = extractPairingCode(ready.pairing.url);
  if (!pairingCode) {
    throw new Error("The Orca pairing URL could not be parsed.");
  }
  return {
    runtimeId: ready.runtimeId,
    endpoint: ready.pairing.endpoint,
    pairingCode,
  };
}

const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

/** Root for per-workspace clones on the Orca host, owned by the orca user. */
export const ORCA_WORKSPACES_ROOT = "/srv/codev/workspaces";

export function orcaWorkspacePath(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error("Invalid workspace id.");
  }
  return `${ORCA_WORKSPACES_ROOT}/${workspaceId}`;
}

/**
 * Build the shell script that idempotently clones a workspace repository on
 * the Orca host. All interpolated values are validated against strict
 * patterns above; the optional token is used once for the clone and removed
 * from the persisted remote so it never lands on disk.
 */
export function buildCloneScript(args: {
  workspaceId: string;
  repository: string;
  defaultBranch: string;
  token?: string | undefined;
}): string {
  const path = orcaWorkspacePath(args.workspaceId);
  if (!REPOSITORY_PATTERN.test(args.repository)) {
    throw new Error("Invalid repository name.");
  }
  if (
    !BRANCH_PATTERN.test(args.defaultBranch) ||
    args.defaultBranch.includes("..")
  ) {
    throw new Error("Invalid branch name.");
  }
  if (args.token !== undefined && !/^[A-Za-z0-9_.-]+$/.test(args.token)) {
    throw new Error("Invalid repository token.");
  }
  const plainUrl = `https://github.com/${args.repository}.git`;
  const cloneUrl =
    args.token === undefined
      ? plainUrl
      : `https://x-access-token:${args.token}@github.com/${args.repository}.git`;
  return [
    `#!/bin/bash`,
    `set -euo pipefail`,
    `mkdir -p ${ORCA_WORKSPACES_ROOT}`,
    `chown orca:orca ${ORCA_WORKSPACES_ROOT}`,
    `if [ ! -d ${path}/.git ]; then`,
    `  rm -rf ${path}`,
    `  sudo -u orca git clone --branch '${args.defaultBranch}' '${cloneUrl}' ${path}`,
    `  sudo -u orca git -C ${path} remote set-url origin '${plainUrl}'`,
    `fi`,
    `echo CLONE_OK`,
  ].join("\n");
}
