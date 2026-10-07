import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CredentialsSignInForm } from "./credentials-sign-in-form";

describe("CredentialsSignInForm", () => {
  it("starts in sign-in mode with email and password only", () => {
    render(<CredentialsSignInForm action={vi.fn()} />);

    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(
      screen.queryByLabelText("New account password requirements"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sign in with email" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/forgot-password");
  });
});
