import "server-only";

import * as awsHost from "./aws-host";
import * as azureHost from "./azure-host";
import { isAzure, type HostState } from "./cloud";

/**
 * The runtime host, whichever cloud it currently lives on.
 *
 * Everything that wakes, inspects or powers down the Firecracker host goes
 * through these three functions, and none of the eight call sites knows or
 * cares which implementation answers. `CLOUD_PROVIDER` picks; see `cloud.ts`
 * for why the default is AWS.
 */

export type { HostState };

export function getHostInstanceId(): Promise<string> {
  return isAzure()
    ? azureHost.getHostInstanceId()
    : awsHost.getHostInstanceId();
}

export function getHostState(): Promise<HostState> {
  return isAzure() ? azureHost.getHostState() : awsHost.getHostState();
}

export function requestHostWake(): Promise<"running" | "starting"> {
  return isAzure() ? azureHost.requestHostWake() : awsHost.requestHostWake();
}

/**
 * Power the host down for the idle lifecycle.
 *
 * Only Azure needs an explicit call here. The AWS host stops itself: its
 * instance carries `InstanceInitiatedShutdownBehavior: stop`, so the
 * orchestrator's own idle timer shutting the OS down is enough to stop
 * billing. An Azure VM shut down from inside the guest stays *allocated* and
 * keeps charging for compute, so the platform has to be told to deallocate
 * it from outside.
 */
export async function releaseIdleHost(): Promise<void> {
  if (isAzure()) await azureHost.deallocateHost();
}
