import "server-only";

import {
  DescribeInstancesCommand,
  EC2Client,
  StartInstancesCommand,
  type InstanceStateName,
} from "@aws-sdk/client-ec2";
import { readServerEnvironment } from "@codev/config";

import { getAwsConfiguration } from "./aws";

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

export async function requestHostWake(): Promise<"running" | "starting"> {
  const { client, instanceId } = createClient();

  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await client.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
    );
    const state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;

    if (state === "running") {
      return "running";
    }
    if (state === "stopped") {
      await client.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
      return "starting";
    }
    if (state === "pending") {
      return "starting";
    }
    if (state === "stopping") {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      continue;
    }
    if (
      state === "shutting-down" ||
      state === "terminated" ||
      state === undefined
    ) {
      throw new Error(
        `The Firecracker host cannot be started from state ${state ?? "unknown"}.`,
      );
    }
  }
  return "starting";
}
