import "server-only";

import * as azureHost from "./azure-host";
import type { HostState } from "./cloud";

/**
 * The runtime host, on Azure.
 *
 * This file is a thin pass-through to `azure-host.ts` rather than the cloud
 * dispatcher it used to be. The EC2 implementation it once selected between
 * has been deleted along with the AWS account it addressed; keeping the
 * indirection costs nothing and keeps the ~thirty call sites naming a host
 * rather than a provider.
 */

export type { HostState };

export function getHostInstanceId(): Promise<string> {
  return azureHost.getHostInstanceId();
}

export function getHostState(): Promise<HostState> {
  return azureHost.getHostState();
}

export function getHostStateFor(name: string): Promise<HostState> {
  return azureHost.getHostStateFor(name);
}

export function requestHostWake(
  stoppingAttempts?: number,
): Promise<"running" | "starting"> {
  return azureHost.requestHostWake(stoppingAttempts);
}

export function requestHostWakeFor(
  name: string,
  stoppingAttempts?: number,
): Promise<"running" | "starting"> {
  return azureHost.requestHostWakeFor(name, stoppingAttempts);
}

/**
 * Power the host down for the idle lifecycle.
 *
 * Azure needs the explicit call: a VM shut down from inside the guest stays
 * *allocated* and keeps charging for compute, so the platform has to be told
 * to deallocate it from outside.
 */
export async function releaseIdleHost(): Promise<void> {
  await azureHost.deallocateHost();
}
