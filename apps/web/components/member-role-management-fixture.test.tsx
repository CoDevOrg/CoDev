import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberRoleManagementFixture } from "./member-role-management-fixture";

describe("MemberRoleManagementFixture", () => {
  it("refreshes Jordan's role and controls immediately when changed to Viewer", () => {
    render(<MemberRoleManagementFixture />);

    expect(
      screen.getByText(
        "Jordan is connected as a Collaborator. Change the role to see the live refresh.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit shared files · allowed" }),
    ).toBeEnabled();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "viewer" },
    });

    expect(screen.getByText("Membership refreshed live")).toBeTruthy();
    expect(
      screen.getByText(
        "Jordan’s Viewer controls updated immediately from the live membership change.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit shared files · unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add agent prompt · unavailable" }),
    ).toBeDisabled();
  });
});
