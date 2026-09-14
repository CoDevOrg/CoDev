import "server-only";

import { readServerEnvironment } from "@codev/config";

/**
 * Which cloud hosts the Firecracker runtime.
 *
 * This exists so the AWS and Azure implementations can both ship, green, in
 * the same build: `host.ts` and `kms.ts` keep their existing signatures and
 * dispatch here, so not one of their thirteen call sites had to change.
 * Flipping `CLOUD_PROVIDER` moves the runtime, which is the property that
 * made the cutover reversible without a deploy.
 *
 * The migration to Azure is done. The AWS implementation is kept for now but
 * nothing runs on it; see `aws-host.ts`.
 */
export type CloudProvider = "aws" | "azure";

/**
 * Defaults to Azure, because that is the runtime that serves production.
 *
 * This default used to be AWS, from when AWS was live. Leaving it there after
 * the cutover meant any environment that forgot the variable — a local
 * checkout, most of all — quietly queried EC2 for a host that no longer
 * exists, and every caller here reports a missing host as "still starting".
 * The result was a workspace that waited forever on a machine nobody was
 * building. An unset variable should land on the cloud that actually runs.
 */
export function getCloudProvider(): CloudProvider {
  return readServerEnvironment().CLOUD_PROVIDER ?? "azure";
}

export function isAzure() {
  return getCloudProvider() === "azure";
}

/**
 * Provider-neutral lifecycle state for the runtime host.
 *
 * These are EC2's state names rather than a new vocabulary, because every
 * consumer already branches on `"running"`, `"stopped"` and `"stopping"`
 * (see readiness.ts, runtime-resume.ts and the orchestrator health route).
 * Inventing neutral names would have meant touching all of them to gain
 * nothing; Azure's power states map onto these cleanly in `azure-host.ts`.
 */
export type HostState =
  | "pending"
  | "running"
  | "shutting-down"
  | "stopped"
  | "stopping"
  | "terminated";
