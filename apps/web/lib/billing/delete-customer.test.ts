import { beforeEach, describe, expect, it, vi } from "vitest";
const stripe = vi.hoisted(() => ({
  customers: { retrieve: vi.fn(), del: vi.fn() },
  checkout: { sessions: { list: vi.fn(), expire: vi.fn() } },
}));
vi.mock("./stripe", () => ({ getStripe: () => stripe }));
import { deleteBillingCustomer } from "./delete-customer";

describe("account billing deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripe.customers.retrieve.mockResolvedValue({ id: "cus_test" });
    stripe.checkout.sessions.list.mockReturnValue([{ id: "cs_open" }]);
  });
  it("expires open checkouts before deleting the Stripe customer", async () => {
    await deleteBillingCustomer("cus_test");
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_open");
    expect(stripe.customers.del).toHaveBeenCalledWith("cus_test");
    expect(
      stripe.checkout.sessions.expire.mock.invocationCallOrder[0],
    ).toBeLessThan(stripe.customers.del.mock.invocationCallOrder[0]!);
  });
  it("allows retry after Stripe deletion but before database commit", async () => {
    stripe.customers.retrieve.mockResolvedValue({
      id: "cus_test",
      deleted: true,
    });
    await deleteBillingCustomer("cus_test");
    expect(stripe.customers.del).not.toHaveBeenCalled();
  });
  it("fails closed for a missing or wrong-mode customer", async () => {
    stripe.customers.retrieve.mockRejectedValue({ code: "resource_missing" });
    await expect(deleteBillingCustomer("cus_test")).rejects.toEqual({
      code: "resource_missing",
    });
    expect(stripe.customers.del).not.toHaveBeenCalled();
  });
});
