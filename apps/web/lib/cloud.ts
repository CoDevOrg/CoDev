import "server-only";

import { readServerEnvironment } from "@codev/config";

/**
 * Which cloud hosts the Firecracker runtime.
 *
 * This exists so the AWS and Azure implementations can both ship, green, in
 * the same build while the migration is in flight: `host.ts` and `kms.ts`
 * keep their existing signatures and dispatch here, so not one of their
 * thirteen call sites had to change. Flipping `CLOUD_PROVIDER` moves the
 * runtime; flipping it back moves it home again, which is the property that
 * makes the cutover reversible without a deploy.
 */
export type CloudProvider = "aws" | "azure";

/**
 * Defaults to AWS. The runtime that serves production today is the AWS one,
 * and an unset variable in some environment nobody thought about must not
 * silently point that environment at a half-provisioned Azure stack.
 */
export function getCloudProvider(): CloudProvider {
  return readServerEnvironment().CLOUD_PROVIDER ?? "aws";
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
