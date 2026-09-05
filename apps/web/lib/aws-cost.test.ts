import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("./aws", () => ({
  getAwsConfiguration: () => ({
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  }),
}));
vi.mock("@aws-sdk/client-cost-explorer", () => ({
  CostExplorerClient: class {
    send(command: unknown) {
      return mockSend(command);
    }
  },
  GetCostAndUsageCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

import { getRealCodevAwsSpend } from "./aws-cost";

describe("getRealCodevAwsSpend", () => {
  beforeEach(() => {
    mockSend.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries activation-day spend with an exclusive next-day end date", async () => {
    mockSend.mockResolvedValue({
      ResultsByTime: [
        {
          Groups: [
            {
              Keys: ["Amazon Elastic Compute Cloud - Compute"],
              Metrics: { UnblendedCost: { Amount: "0.2269512" } },
            },
            {
              Keys: ["Amazon VPC"],
              Metrics: { UnblendedCost: { Amount: "0.0481375" } },
            },
          ],
        },
      ],
    });

    const spend = await getRealCodevAwsSpend();

    expect(spend).toMatchObject({
      ec2Usd: 0.2269512,
      startDate: "2026-09-05",
      endDate: "2026-09-06",
    });
    expect(spend.totalUsd).toBeCloseTo(0.2750887);
    expect(spend.overheadUsd).toBeCloseTo(0.0481375);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({
      input: {
        TimePeriod: { Start: "2026-09-05", End: "2026-09-06" },
        Filter: { Tags: { Key: "Project", Values: ["CoDev"] } },
      },
    });
  });
});
