import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InviteLifecycleFixture } from "./invite-lifecycle-fixture";

describe("InviteLifecycleFixture", () => {
  it("creates a time-limited invite and lets Jordan accept it once", () => {
    render(<InviteLifecycleFixture />);

    expect(screen.getByText(/waiting for invite/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));

    expect(screen.getByText("Expires in 24 hours · single use")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept as Jordan" }));

    expect(screen.getByText(/joined via invite/)).toBeTruthy();
    expect(screen.getByText(/accepted once and cannot be reused/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Invite already used" }),
    ).toBeDisabled();
  });

  it("rejects Jordan after Alex revokes the invite", () => {
    render(<InviteLifecycleFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept as Jordan" }));

    expect(
      screen.getByText(
        "Jordan cannot join: Alex revoked this invite before acceptance.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Join rejected" }),
    ).toBeDisabled();
  });

  it("rejects Jordan after the invite expires", () => {
    render(<InviteLifecycleFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate expiry" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept as Jordan" }));

    expect(
      screen.getByText(
        "Jordan cannot join: this invite expired before acceptance.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Join rejected" }),
    ).toBeDisabled();
  });
});
