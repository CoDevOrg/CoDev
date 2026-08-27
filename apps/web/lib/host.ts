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

/**
 * Failures of `StartInstances` that mean "not right now" rather than
 * "never": the capacity pool is momentarily full, or the instance is still
 * transitioning between states and EC2 will accept the same call shortly.
 * None of these are the user's problem, and none of them should reach the
 * UI - the caller polls, so reporting the host as still starting lets the
 * next attempt succeed silently.
 *
 * `InsufficientInstanceCapacity` is rare on the on-demand host this runs on
 * today, but it was routine while the host was a Spot instance ("there is no
 * available Spot capacity"), which is exactly the kind of raw AWS text that
 * must never be shown to somebody opening a workspace.
 */
const TRANSIENT_START_ERROR_NAMES = new Set([
  "InsufficientInstanceCapacity",
  "InsufficientHostCapacity",
  "InsufficientCapacity",
  "IncorrectInstanceState",
  "IncorrectSpotRequestState",
  "InstanceLimitExceeded",
  "SpotMaxPriceTooLow",
  "Unsupported",
  ...RETRYABLE_AWS_ERROR_NAMES,
]);

function isTransientStartFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (TRANSIENT_START_ERROR_NAMES.has(error.name)) return true;
  // Capacity refusals do not always arrive under a distinct error name.
  return /capacity|try again|temporarily/i.test(error.message);
}

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
        // A host that cannot be started *this second* is still a host that
        // is starting as far as the caller is concerned: it polls, and the
        // next attempt usually succeeds. Surfacing the AWS text here would
        // turn a self-healing hiccup into an error screen.
        if (!isTransientStartFailure(error)) {
          throw error;
        }
      }
      return "starting";
    }
    if (state === "pending") {
      return "starting";
    }
    if (state === "stopping") {
      // The instance is on its way down; it becomes startable once it lands
      // in `stopped`, so wait for that rather than reporting a failure.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    if (
      state === "shutting-down" ||
      state === "terminated" ||
      state === undefined
    ) {
      // `resolveHost` re-resolves through the stack's tags on the next call,
      // so a replaced host recovers on its own. Report "starting" and let the
      // caller poll into the replacement.
      return "starting";
    }
  }
  return "starting";
}
