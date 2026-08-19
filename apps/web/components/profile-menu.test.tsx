import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: { alt?: string; src?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={props.alt ?? ""} src={props.src} />
  ),
}));

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

vi.mock("@/app/actions/auth", () => ({
  signOutToHome: vi.fn(),
}));

vi.mock("@/app/actions/github", () => ({
  connectGitHubAccount: vi.fn(),
}));

vi.mock("@/components/clerk-sign-out", () => ({
  ClerkSignOut: () => <button type="button">Sign out</button>,
}));

import { ProfileMenu } from "./profile-menu";

describe("ProfileMenu", () => {
  it("exposes settings and sign out for the account avatar", () => {
    const { container } = render(
      <ProfileMenu
        compact
        useClerkAuth={false}
        user={{ name: "Ada", githubLogin: "ada", image: null }}
      />,
    );

    expect(
      container.querySelector("details.profile-menu-compact"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.queryByRole("link", { name: "Profile" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("shows the member's real name over their GitHub login when both are known", () => {
    const { container } = render(
      <ProfileMenu
        useClerkAuth={false}
        user={{ name: "Ada Lovelace", githubLogin: "ada", image: null }}
      />,
    );

    expect(container.querySelector(".profile-menu-name")).toHaveTextContent(
      "Ada Lovelace",
    );
    expect(screen.queryByText("ada")).not.toBeInTheDocument();
  });

  it("falls back to the GitHub login when no name is set", () => {
    const { container } = render(
      <ProfileMenu
        useClerkAuth={false}
        user={{ githubLogin: "ada", image: null }}
      />,
    );

    expect(container.querySelector(".profile-menu-name")).toHaveTextContent(
      "ada",
    );
  });
});
