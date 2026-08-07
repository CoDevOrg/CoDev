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
});
