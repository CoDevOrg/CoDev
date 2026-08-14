import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CredentialsSignInForm } from "./credentials-sign-in-form";

describe("CredentialsSignInForm", () => {
  it("shows each new-account password requirement and updates it as the user types", () => {
    render(<CredentialsSignInForm action={vi.fn()} />);

    expect(
      screen.getByLabelText("New account password requirements"),
    ).toHaveTextContent("At least 10 characters");
    expect(
      screen.getByLabelText("New account password requirements"),
    ).toHaveTextContent("One uppercase letter");

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "StrongPass1!" },
    });

    expect(
      screen.getByLabelText("New account password requirements"),
    ).toHaveTextContent("✓At least 10 characters");
    expect(
      screen.getByLabelText("New account password requirements"),
    ).toHaveTextContent("✓One special character");
  });
});
