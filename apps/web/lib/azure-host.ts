import "server-only";

import { ComputeManagementClient } from "@azure/arm-compute";
import { readServerEnvironment } from "@codev/config";

import {
  getAzureCredential,
  getAzureResourceGroup,
  getAzureSubscriptionId,
} from "./azure";
import type { HostState } from "./cloud";

/**
 * The Azure half of `host.ts`. Mirrors the EC2 implementation function for
 * function, including its retry and transient-failure behaviour, because the
 * callers poll and the UI contract is identical: a host that cannot start
 * *this second* is reported as starting, never as an error.
 */

let client: ComputeManagementClient | undefined;

function getClient() {
  return (client ??= new ComputeManagementClient(
    getAzureCredential(),
    getAzureSubscriptionId(),
  ));
}

/**
 * Azure's throttling and transient-conflict surface. `Conflict` is the one
 * that matters in practice: it is what a start returns while another power
 * operation on the same VM is still settling, which the stop-when-idle
 * lifecycle makes routine rather than exceptional.
 */
const RETRYABLE_AZURE_CODES = new Set([
  "TooManyRequests",
  "RetryableError",
  "InternalServerError",
  "ServiceUnavailable",
  "GatewayTimeout",
  "OperationNotAllowed",
]);

const TRANSIENT_START_CODES = new Set([
  "Conflict",
  "AllocationFailed",
  "ZonalAllocationFailed",
  "OverconstrainedAllocationRequest",
  "SkuNotAvailable",
  ...RETRYABLE_AZURE_CODES,
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  if (candidate.statusCode === 429) return "TooManyRequests";
  return undefined;
}

function isTransientStartFailure(error: unknown) {
  const code = errorCode(error);
  if (code && TRANSIENT_START_CODES.has(code)) return true;
  return (
    error instanceof Error &&
    /capacity|try again|temporarily|in progress/i.test(error.message)
  );
}

async function withAzureRetry<T>(operation: () => Promise<T>): Promise<T> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = errorCode(error);
      const retryable = code !== undefined && RETRYABLE_AZURE_CODES.has(code);
      if (!retryable || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("unreachable");
}

/**
 * Azure reports power as a status code on the instance view. The mapping to
 * `HostState` has one subtlety worth stating: Azure distinguishes *stopped*
 * (powered off, still allocated, still billing for compute) from
 * *deallocated* (released, billing only for disks). Only the latter is what
 * EC2 means by "stopped", but both are startable and neither is running, so
 * both map to `"stopped"` here. `deallocateHost` below is careful to produce
 * the cheap one.
 */
function toHostState(powerCode: string | undefined): HostState {
  switch (powerCode) {
    case "PowerState/running":
      return "running";
    case "PowerState/starting":
      return "pending";
    case "PowerState/stopping":
    case "PowerState/deallocating":
      return "stopping";
    case "PowerState/stopped":
    case "PowerState/deallocated":
      return "stopped";
    default:
      return "pending";
  }
}

async function describeHost(name: string) {
  const vm = await withAzureRetry(() =>
    getClient().virtualMachines.get(getAzureResourceGroup(), name, {
      expand: "instanceView",
    }),
  );
  const power = vm.instanceView?.statuses?.find((status) =>
    status.code?.startsWith("PowerState/"),
  )?.code;
  return toHostState(power);
}

/**
 * Resolve the host the same way the EC2 path does: prefer an explicitly
 * configured name, otherwise find it by the tags the stack applies. Tag
 * discovery is what lets a replaced host be picked up without a redeploy of
 * apps/web.
 */
async function resolveHost(): Promise<{ name: string; state: HostState }> {
  const configured = readServerEnvironment().AZURE_HOST_VM_NAME?.trim();
  if (configured) {
    try {
      return { name: configured, state: await describeHost(configured) };
    } catch (error) {
      if (errorCode(error) !== "ResourceNotFound") throw error;
    }
  }

  const resourceGroup = getAzureResourceGroup();
  for await (const vm of getClient().virtualMachines.list(resourceGroup)) {
    const tags = vm.tags ?? {};
    if (tags.Name === "codev-firecracker-host" && tags.Project === "CoDev") {
      if (!vm.name) continue;
      return { name: vm.name, state: await describeHost(vm.name) };
    }
  }
  throw new Error("The configured Firecracker host was not found.");
}

export async function getHostInstanceId(): Promise<string> {
  return (await resolveHost()).name;
}

export async function getHostState(): Promise<HostState> {
  return (await resolveHost()).state;
}

export async function requestHostWake(): Promise<"running" | "starting"> {
  const resolved = await resolveHost();
  const { name } = resolved;

  for (let attempt = 0; attempt < 30; attempt++) {
    const state = attempt === 0 ? resolved.state : await describeHost(name);

    if (state === "running") return "running";

    if (state === "stopped") {
      try {
        // Deliberately not awaiting completion: the caller polls, and a cold
        // Azure VM can take a minute or more to reach `running`. Kicking the
        // operation off and reporting "starting" is what keeps the workspace
        // open path responsive.
        await withAzureRetry(async () => {
          await getClient().virtualMachines.beginStart(
            getAzureResourceGroup(),
            name,
          );
        });
      } catch (error) {
        // Same contract as the EC2 path: a host that cannot start right now
        // is still a host that is starting. Raw Azure allocation text must
        // never reach somebody opening a workspace.
        if (!isTransientStartFailure(error)) throw error;
      }
      return "starting";
    }

    if (state === "pending") return "starting";

    if (state === "stopping") {
      // Becomes startable once it lands in `stopped`, so wait rather than
      // reporting a failure.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }

    // `resolveHost` re-resolves through tags on the next call, so a replaced
    // host recovers on its own.
    return "starting";
  }
  return "starting";
}

/**
 * Power the host down for the idle lifecycle.
 *
 * This must be `beginDeallocate`, never `beginPowerOff`. A powered-off Azure
 * VM keeps its compute allocation and keeps billing for it, so the stop that
 * the idle timer performs would save nothing at all — the exact opposite of
 * what the AWS `StopInstances` it replaces does.
 */
export async function deallocateHost(): Promise<void> {
  const { name } = await resolveHost();
  await withAzureRetry(async () => {
    await getClient().virtualMachines.beginDeallocate(
      getAzureResourceGroup(),
      name,
    );
  });
}
