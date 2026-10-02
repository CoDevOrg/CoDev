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
  createCheckoutSession: mocks.create,
}));

import { ApiError } from "@/lib/http/api-route";
import { POST } from "./route";

const call = () =>
  POST(
    new Request("https://codev.test/api/billing/checkout", { method: "POST" }),
    { params: Promise.resolve({}) },
  );

describe("billing checkout route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1", email: "a@b.c" });
  });
  afterEach(() => vi.resetAllMocks());

  it("requires sign-in", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns the checkout URL for the caller's own origin", async () => {
    mocks.create.mockResolvedValue("https://checkout.stripe.com/c/pay/cs_1");
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      "https://codev.test",
    );
  });

  it("refuses a second subscription with 409", async () => {
    mocks.create.mockRejectedValue(new ApiError("Already subscribed.", 409));
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Already subscribed." });
  });
});
