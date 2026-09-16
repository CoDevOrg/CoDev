import "server-only";

import * as azureHost from "./azure-host";
import type { HostState } from "./cloud";

/**
 * The runtime host. Azure — the migration is done.
 *
 * The EC2 implementation is parked in `lib/retired/aws-host.ts`, out of the
 * typecheck program. It was reachable from here through `isAzure()`, and that
 * one import loaded `@aws-sdk/client-ec2` — 1012 declaration files, a fifth of
 * this app's typecheck — to serve a branch nothing selects and a host that no
 * longer exists.
 *
 * To bring it back: restore the import, put the `isAzure()` ternaries back on
 * these three functions, and drop `lib/retired` from the tsconfig `exclude`.
 * Nothing else moved.
 */

export type { HostState };

export function getHostInstanceId(): Promise<string> {
  return azureHost.getHostInstanceId();
}

export function getHostState(): Promise<HostState> {
  return azureHost.getHostState();
}

export function requestHostWake(
  stoppingAttempts?: number,
): Promise<"running" | "starting"> {
  return azureHost.requestHostWake(stoppingAttempts);
}

/**
 * Power the host down for the idle lifecycle.
 *
 * Azure needs the explicit call: a VM shut down from inside the guest stays
 * *allocated* and keeps charging for compute, so the platform has to be told
 * to deallocate it from outside. (The EC2 host stopped itself — its instance
 * carried `InstanceInitiatedShutdownBehavior: stop` — which is why this was
 * once guarded by `isAzure()`.)
 */
export async function releaseIdleHost(): Promise<void> {
  await azureHost.deallocateHost();
}
