import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("@/lib/billing/webhook", () => ({ handleStripeEvent: mocks.handle }));
vi.mock("@/lib/platform/observability", () => ({ logEvent: vi.fn() }));

import { POST } from "./route";

const secret = "whsec_test_secret";
const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1" } },
});

function request(body: string, signature?: string) {
  return new Request("https://codev.test/api/billing/webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  });
}

describe("billing webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    mocks.handle.mockResolvedValue({ handled: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("rejects a request with no signature", async () => {
    expect((await POST(request(payload))).status).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("rejects a bad signature and a tampered body", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect((await POST(request(payload, "t=1,v1=bad"))).status).toBe(400);
    expect((await POST(request(payload + " ", header))).status).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("applies a correctly signed event", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const response = await POST(request(payload, header));
    expect(response.status).toBe(200);
    expect(mocks.handle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_1" }),
    );
  });

  it("returns 500 when processing fails so Stripe retries", async () => {
    mocks.handle.mockRejectedValue(new Error("db down"));
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect((await POST(request(payload, header))).status).toBe(500);
  });
});
