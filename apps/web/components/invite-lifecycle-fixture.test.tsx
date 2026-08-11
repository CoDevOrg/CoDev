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
});
