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

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

import { ProfileMenu } from "./profile-menu";

describe("ProfileMenu", () => {
  it("exposes settings, profile, and sign out for the account avatar", () => {
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
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/settings/personal/profile",
    );
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});
