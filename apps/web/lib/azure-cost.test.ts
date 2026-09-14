import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch, mockGetToken } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("./azure", () => ({
  getAzureCredential: () => ({ getToken: mockGetToken }),
  getAzureResourceGroup: () => "codev-prod",
  getAzureSubscriptionId: () => "00000000-0000-0000-0000-000000000000",
}));

vi.stubGlobal("fetch", mockFetch);

import { getRealCodevAzureSpend } from "./azure-cost";

describe("getRealCodevAzureSpend", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue({ token: "test-token" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T16:00:00.000Z"));
  });

  it("queries Azure Cost Management and separates VM compute from overhead", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        properties: {
          columns: [
            { name: "PreTaxCost" },
            { name: "ServiceName" },
            { name: "Currency" },
          ],
          rows: [
            ["0.2269512", "Virtual Machines", "USD"],
            [0.0481375, "Storage", "USD"],
          ],
        },
      }),
    });

    const spend = await getRealCodevAzureSpend();

    expect(spend).toMatchObject({
      computeCost: 0.2269512,
      currency: "USD",
      startDate: "2026-09-05",
      endDate: "2026-09-06",
    });
    expect(spend.totalCost).toBeCloseTo(0.2750887);
    expect(spend.overheadCost).toBeCloseTo(0.0481375);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, request] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/codev-prod/providers/Microsoft.CostManagement/query",
    );
    expect(request.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      type: "ActualCost",
      dataset: { grouping: [{ type: "Dimension", name: "ServiceName" }] },
    });
  });

  it("returns zero when Azure billing is unavailable", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    await expect(getRealCodevAzureSpend()).resolves.toMatchObject({
      totalCost: 0,
      computeCost: 0,
      overheadCost: 0,
    });
  });

  it("retries throttled cost queries before falling back", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "0.25" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          properties: {
            columns: [{ name: "PreTaxCost" }, { name: "ServiceName" }],
            rows: [["1.25", "Virtual Machines"]],
          },
        }),
      });

    const spendPromise = getRealCodevAzureSpend();
    await vi.advanceTimersByTimeAsync(250);
    await expect(spendPromise).resolves.toMatchObject({
      totalCost: 1.25,
      computeCost: 1.25,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
