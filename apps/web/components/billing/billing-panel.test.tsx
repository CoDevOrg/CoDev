import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingStatus } from "@codev/contracts";

import { BillingPanel } from "./billing-panel";

const base: BillingStatus = {
  planId: "free",
  planName: "Free",
  status: null,
  hasAccess: false,
  accessSource: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  hasStripeCustomer: false,
  priceUsdPerMonth: 20,
};

describe("BillingPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers a $20 subscription to a member with no plan", () => {
    render(<BillingPanel status={base} />);
    expect(screen.getByText("Not subscribed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Subscribe for $20/month" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage billing" })).toBeNull();
  });

  it("shows the renewal date and portal for an active subscriber", () => {
    render(
      <BillingPanel
        status={{
          ...base,
          planId: "pro",
          planName: "Individual",
          status: "active",
          hasAccess: true,
          accessSource: "subscription",
          currentPeriodEnd: "2026-11-01T00:00:00.000Z",
          hasStripeCustomer: true,
        }}
      />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Renews on November 1, 2026.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage billing" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Subscribe/ })).toBeNull();
  });

  it("says when a cancelled plan ends while access continues", () => {
    render(
      <BillingPanel
        status={{
          ...base,
          planId: "pro",
          planName: "Individual",
          status: "active",
          hasAccess: true,
          accessSource: "subscription",
          currentPeriodEnd: "2026-11-01T00:00:00.000Z",
          cancelAtPeriodEnd: true,
          hasStripeCustomer: true,
        }}
      />,
    );
    expect(screen.getByText("Ending")).toBeInTheDocument();
    expect(screen.getByText(/ends on November 1, 2026/)).toBeInTheDocument();
  });

  it("points a failed payment at the portal, not a second subscription", () => {
    render(
      <BillingPanel
        status={{
          ...base,
          planId: "pro",
          planName: "Individual",
          status: "past_due",
          hasStripeCustomer: true,
        }}
      />,
    );
    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update payment method" }),
    ).toBeInTheDocument();
  });

  it("shows no price or buttons for an admin comp", () => {
    render(
      <BillingPanel
        status={{
          ...base,
          planId: "pro",
          planName: "Individual",
          status: "active",
          hasAccess: true,
          accessSource: "admin_grant",
        }}
      />,
    );
    expect(screen.getByText("Included")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends the browser to the Stripe Checkout URL", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ url: "https://checkout.stripe.com/x" }),
          ),
      ),
    );
    render(<BillingPanel status={base} />);
    fireEvent.click(screen.getByRole("button", { name: /Subscribe/ }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/x"),
    );
    expect(fetch).toHaveBeenCalledWith("/api/billing/checkout", {
      method: "POST",
    });
  });

  it("shows the server's reason when checkout cannot start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Billing is not configured." }),
            {
              status: 503,
            },
          ),
      ),
    );
    render(<BillingPanel status={base} />);
    fireEvent.click(screen.getByRole("button", { name: /Subscribe/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Billing is not configured.",
    );
  });
});
