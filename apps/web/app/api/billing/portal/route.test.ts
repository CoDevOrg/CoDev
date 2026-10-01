import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));
vi.mock("@/lib/billing/checkout", () => ({
  createPortalSession: mocks.create,
}));

import { POST } from "./route";

const call = () =>
  POST(
    new Request("https://codev.test/api/billing/portal", { method: "POST" }),
    {
      params: Promise.resolve({}),
    },
  );

describe("billing portal route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => vi.resetAllMocks());

  it("requires sign-in", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("returns the portal URL for the signed-in member only", async () => {
    mocks.create.mockResolvedValue("https://billing.stripe.com/p/session/x");
    const response = await call();
    expect(await response.json()).toEqual({
      url: "https://billing.stripe.com/p/session/x",
    });
    expect(mocks.create).toHaveBeenCalledWith("user-1", "https://codev.test");
  });
});
