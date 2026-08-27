import { beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: class {
    send = aws.send;
  },
  DescribeInstancesCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  StartInstancesCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("@codev/config", () => ({
  readServerEnvironment: () => ({
    AWS_HOST_INSTANCE_ID: "i-retired",
  }),
}));

vi.mock("./aws", () => ({
  getAwsConfiguration: () => ({ region: "us-east-2" }),
}));

import { requestHostWake } from "./host";

describe("Firecracker host resolution", () => {
  beforeEach(() => {
    aws.send.mockReset();
  });

  it("recovers from a stale configured instance after a rollout", async () => {
    const missing = new Error("missing");
    missing.name = "InvalidInstanceID.NotFound";
    aws.send
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: "i-current",
                LaunchTime: new Date("2026-08-07T05:00:00Z"),
                State: { Name: "stopped" },
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({});

    await expect(requestHostWake()).resolves.toBe("starting");
    expect(aws.send).toHaveBeenCalledTimes(3);
    expect(aws.send.mock.calls[1]?.[0].input).toMatchObject({
      Filters: expect.arrayContaining([
        { Name: "tag:Project", Values: ["CoDev"] },
      ]),
    });
    expect(aws.send.mock.calls[2]?.[0].input).toEqual({
      InstanceIds: ["i-current"],
    });
  });

  it("still raises a misconfiguration when StartInstances is denied", async () => {
    // A denied call never fixes itself, so it must keep reaching the server
    // logs and the readiness probe. Callers decide what the person opening a
    // workspace sees; this layer's job is to stay honest about the cause.
    const denied = new Error(
      "User ... is not authorized to perform: ec2:StartInstances",
    );
    denied.name = "AccessDeniedException";
    aws.send
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }],
      })
      .mockRejectedValueOnce(denied);

    await expect(requestHostWake()).rejects.toThrow(/ec2:StartInstances/);
  });

  it("reports a capacity refusal as still starting rather than failing", async () => {
    // The failure that made reopening an old workspace break outright:
    // EC2 could not start the host right now. It resolves on its own, and
    // the caller polls, so it must not become an error.
    const capacity = new Error(
      "You can't start the Spot Instance 'i-retired' because there is no available Spot capacity.",
    );
    capacity.name = "Unsupported";
    aws.send
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }],
      })
      .mockRejectedValue(capacity);

    await expect(requestHostWake()).resolves.toBe("starting");
  });

  it("reports a replaced host as still starting so the next poll re-resolves it", async () => {
    aws.send.mockResolvedValueOnce({
      Reservations: [{ Instances: [{ State: { Name: "terminated" } }] }],
    });
    // A terminated instance fails the `resolveHost` freshness check, so it
    // falls through to the tag lookup for the stack's current host.
    aws.send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: "i-replacement",
              LaunchTime: new Date("2026-08-27T05:00:00Z"),
              State: { Name: "pending" },
            },
          ],
        },
      ],
    });

    await expect(requestHostWake()).resolves.toBe("starting");
  });

  it("retries StartInstances once on transient throttling before succeeding", async () => {
    const throttled = new Error("Rate exceeded");
    throttled.name = "RequestLimitExceeded";
    aws.send
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }],
      })
      .mockRejectedValueOnce(throttled)
      .mockResolvedValueOnce({});

    await expect(requestHostWake()).resolves.toBe("starting");
    expect(aws.send).toHaveBeenCalledTimes(3);
  });
});
