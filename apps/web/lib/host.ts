import "server-only";

import {
  DescribeInstancesCommand,
  EC2Client,
  StartInstancesCommand,
  type InstanceStateName,
} from "@aws-sdk/client-ec2";
import { readServerEnvironment } from "@codev/config";

import { getAwsConfiguration } from "./aws";

const pollIntervalMs = 5_000;
const defaultWakeTimeoutMs = 180_000;

function getHostConfiguration() {
  const environment = readServerEnvironment();
  if (!environment.AWS_HOST_INSTANCE_ID) {
    throw new Error("AWS_HOST_INSTANCE_ID is not configured.");
  }
  return {
    ...getAwsConfiguration(),
    instanceId: environment.AWS_HOST_INSTANCE_ID,
  };
}

function createClient() {
  const configuration = getHostConfiguration();
  return {
    client: new EC2Client({
      region: configuration.region,
      credentials: configuration.credentials,
    }),
    instanceId: configuration.instanceId,
  };
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function getHostState(): Promise<InstanceStateName> {
  const { client, instanceId } = createClient();
  const response = await client.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
  );
  const state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;
  if (!state) {
    throw new Error("The configured Firecracker host was not found.");
  }
  return state;
}

export async function ensureHostRunning(
  timeoutMs = defaultWakeTimeoutMs,
): Promise<"running" | "started"> {
  const { client, instanceId } = createClient();
  const deadline = Date.now() + timeoutMs;
  let started = false;

  while (Date.now() < deadline) {
    const response = await client.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
    );
    const state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;

    if (state === "running") {
      return started ? "started" : "running";
    }
    if (state === "stopped") {
      await client.send(
        new StartInstancesCommand({ InstanceIds: [instanceId] }),
      );
      started = true;
    } else if (
      state === "shutting-down" ||
      state === "terminated" ||
      state === undefined
    ) {
      throw new Error(
        `The Firecracker host cannot be started from state ${state ?? "unknown"}.`,
      );
    }

    await delay(pollIntervalMs);
  }

  throw new Error("The Firecracker host did not become ready in time.");
}
