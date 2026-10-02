import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  customers: { retrieve: vi.fn(), create: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn(), create: vi.fn() } },
  subscriptions: { retrieve: vi.fn() },
}));
const syncMock = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => ({
  getSubscriptionRow: vi.fn(),
  resolveBillingAccess: vi.fn(),
}));
const setMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@codev/db", () => ({
  schema: { organizationSubscriptions: { organizationId: "organization_id" } },
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    update: () => ({ set: setMock.mockReturnValue({ where: vi.fn() }) }),
  }),
}));
vi.mock("./access", () => accessMock);
vi.mock("./config", () => ({ requireBillingEnv: () => "price_test" }));
vi.mock("./stripe", () => ({ getStripe: () => stripeMock }));
vi.mock("./subscriptions", () => ({
  stripeId: (value: unknown) =>
    typeof value === "string"
      ? value
      : ((value as { id?: string })?.id ?? null),
  syncStripeSubscription: syncMock,
}));

import { createCheckoutSession, syncCheckoutSession } from "./checkout";

const complete = {
  client_reference_id: "user-1",
  mode: "subscription",
  status: "complete",
  subscription: "sub_1",
};

describe("syncCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.subscriptions.retrieve.mockResolvedValue({ id: "sub_1" });
    syncMock.mockResolvedValue({ synced: true });
  });

  it("syncs the subscription of a completed session owned by the member", async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(complete);
    await expect(syncCheckoutSession("user-1", "cs_test_abc")).resolves.toBe(
      true,
    );
    expect(syncMock).toHaveBeenCalledWith({ id: "sub_1" });
  });

  it("ignores malformed session ids without calling Stripe", async () => {
    await expect(syncCheckoutSession("user-1", "evil/../id")).resolves.toBe(
      false,
    );
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["another member", { ...complete, client_reference_id: "user-2" }],
    ["an unpaid session", { ...complete, status: "open" }],
    ["a payment-mode session", { ...complete, mode: "payment" }],
    ["a session without a subscription", { ...complete, subscription: null }],
  ])("ignores %s", async (_name, session) => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(session);
    await expect(syncCheckoutSession("user-1", "cs_test_abc")).resolves.toBe(
      false,
    );
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("createCheckoutSession customer", () => {
  const member = { id: "user-1", email: "a@example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    accessMock.resolveBillingAccess.mockReturnValue({ hasAccess: false });
    stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/x",
    });
  });

  it("reuses a stored customer that Stripe knows", async () => {
    accessMock.getSubscriptionRow.mockResolvedValue({
      provider: "stripe",
      providerCustomerId: "cus_old",
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_old" });
    await createCheckoutSession(member, "https://app.test");
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_old" }),
    );
  });

  it("replaces a stored customer from the other Stripe mode", async () => {
    accessMock.getSubscriptionRow.mockResolvedValue({
      provider: "stripe",
      providerCustomerId: "cus_other_mode",
    });
    stripeMock.customers.retrieve.mockRejectedValue({
      code: "resource_missing",
    });
    await createCheckoutSession(member, "https://app.test");
    expect(stripeMock.customers.create).toHaveBeenCalledOnce();
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new" }),
    );
  });
});
