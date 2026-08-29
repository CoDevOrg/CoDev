import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { RequestAccessForm } from "./request-access-form";

describe("RequestAccessForm", () => {
  it("asks for email, optional name, and optional building persona", () => {
    render(<RequestAccessForm />);

    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText("Name (optional)")).not.toBeRequired();
    expect(
      screen.getByRole("group", { name: "What are you building? (optional)" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/GitHub/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Tell us about the project/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("↗")).not.toBeInTheDocument();
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
  });
});
