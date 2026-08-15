import { fireEvent, render, screen } from "@testing-library/react";
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
      screen.getByRole("button", { name: "Create an account" }),
    ).toBeVisible();
  });

  it("switches to create-account and shows name plus password requirements", () => {
    render(<CredentialsSignInForm action={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(screen.getByLabelText("Name")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(
      screen.getByLabelText("New account password requirements"),
    ).toHaveTextContent("At least 10 characters");

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
