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
  const instanceId =
    environment.AWS_HOST_INSTANCE_ID &&
    environment.AWS_HOST_INSTANCE_ID.trim() !== ""
      ? environment.AWS_HOST_INSTANCE_ID
      : "i-03013fac5bc0e7bd0";
  return {
    ...getAwsConfiguration(),
    instanceId,
  };
}

function createClient() {
  const configuration = getHostConfiguration();
  return {
    client: new EC2Client({
      region: configuration.region,
      credentials: configuration.credentials,
    }),
    configuredInstanceId: configuration.instanceId,
  };
}

/** AWS error names worth a couple of quick retries: transient throttling and
 * connection issues, not permission or not-found problems that retrying
 * can't fix. */
const RETRYABLE_AWS_ERROR_NAMES = new Set([
  "RequestLimitExceeded",
  "Throttling",
  "ThrottlingException",
  "InternalError",
  "InternalFailure",
  "ServiceUnavailable",
]);

async function withAwsRetry<T>(operation: () => Promise<T>): Promise<T> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof Error && RETRYABLE_AWS_ERROR_NAMES.has(error.name);
      if (!retryable || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("unreachable");
}

async function describeInstance(
  client: EC2Client,
  instanceId: string,
): Promise<InstanceStateName | undefined> {
  const response = await withAwsRetry(() =>
    client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] })),
  );
  return response.Reservations?.[0]?.Instances?.[0]?.State?.Name;
}

async function resolveHost(client: EC2Client, configuredInstanceId: string) {
  try {
    const state = await describeInstance(client, configuredInstanceId);
    if (state && state !== "terminated" && state !== "shutting-down") {
      return { instanceId: configuredInstanceId, state };
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.name !== "InvalidInstanceID.NotFound"
    ) {
      throw error;
    }
  }

  const response = await client.send(
    new DescribeInstancesCommand({
      Filters: [
        { Name: "tag:Name", Values: ["codev-firecracker-host"] },
        { Name: "tag:Project", Values: ["CoDev"] },
        {
          Name: "instance-state-name",
          Values: ["pending", "running", "stopping", "stopped"],
        },
      ],
    }),
  );
  const instance = response.Reservations?.flatMap(
    (reservation) => reservation.Instances ?? [],
  )
    .filter((candidate) => candidate.InstanceId && candidate.State?.Name)
    .sort(
      (left, right) =>
        (right.LaunchTime?.getTime() ?? 0) - (left.LaunchTime?.getTime() ?? 0),
    )[0];
  if (!instance?.InstanceId || !instance.State?.Name) {
    throw new Error("The configured Firecracker host was not found.");
  }
  return { instanceId: instance.InstanceId, state: instance.State.Name };
}

export async function getHostInstanceId(): Promise<string> {
  const { client, configuredInstanceId } = createClient();
  return (await resolveHost(client, configuredInstanceId)).instanceId;
}

export async function getHostState(): Promise<InstanceStateName> {
  const { client, configuredInstanceId } = createClient();
  return (await resolveHost(client, configuredInstanceId)).state;
}

export async function requestHostWake(): Promise<"running" | "starting"> {
  const { client, configuredInstanceId } = createClient();
  const resolved = await resolveHost(client, configuredInstanceId);
  const { instanceId } = resolved;

  for (let attempt = 0; attempt < 30; attempt++) {
    const state =
      attempt === 0
        ? resolved.state
        : await describeInstance(client, instanceId);

    if (state === "running") {
      return "running";
    }
    if (state === "stopped") {
      try {
        await withAwsRetry(() =>
          client.send(new StartInstancesCommand({ InstanceIds: [instanceId] })),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `The Firecracker host could not be started (${instanceId}): ${reason}`,
        );
      }
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
