import { fireEvent, render, screen } from "@testing-library/react";
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

import { ProfileMenu } from "./profile-menu";

function openMenu() {
  const trigger = screen.getByRole("button", { name: /^Account menu for/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

describe("ProfileMenu", () => {
  it("exposes settings, billing, and sign out from the account avatar", () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    render(
      <ProfileMenu
        compact
        user={{ name: "Ada", githubLogin: "ada", image: null }}
      />,
    );

    expect(openMenu()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.getByRole("menuitem", { name: "Billing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Profile" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(submit).toHaveBeenCalledOnce();
    submit.mockRestore();
  });

  it("shows the member's real name over their GitHub login when both are known", () => {
    const { container } = render(
      <ProfileMenu
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
      <ProfileMenu user={{ githubLogin: "ada", image: null }} />,
    );

    expect(container.querySelector(".profile-menu-name")).toHaveTextContent(
      "ada",
    );
  });

  it("identifies the account by email inside the menu", () => {
    render(
      <ProfileMenu
        user={{ name: "Ada", email: "ada@example.com", image: null }}
      />,
    );
    openMenu();

    expect(screen.getByRole("menu")).toHaveTextContent("ada@example.com");
  });

  it("sends settings to the public host from the admin host", () => {
    render(<ProfileMenu isAdminHost user={{ name: "Ada", image: null }} />);
    openMenu();

    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
      "href",
      "https://www.trycodev.com/settings",
    );
  });
});
