import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProfileSettings } from "./settings-content";

vi.mock("@/app/actions/github", () => ({
  connectGitHubAccount: vi.fn(),
}));

describe("ProfileSettings", () => {
  it("shows connected Google and GitHub identities as one CoDev account", () => {
    render(
      <ProfileSettings
        githubStatus={undefined}
        connectedAccounts={{
          google: { connected: true },
          github: { connected: true, login: "yousef20920" },
          sameCoDevUser: true,
          hasPassword: true,
        }}
        user={{
          id: "user-1",
          name: "Yousef Abdelhadi",
          email: "yousef@example.com",
          githubLogin: "yousef20920",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Connected accounts" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(1);
    expect(screen.getAllByText("@yousef20920")).toHaveLength(2);
    expect(
      screen.getByText(
        "Google and GitHub are connected to this same CoDev account.",
      ),
    ).toBeInTheDocument();
  });

  it("does not claim the accounts match when either provider is absent", () => {
    render(
      <ProfileSettings
        githubStatus={undefined}
        connectedAccounts={{
          google: { connected: true },
          github: { connected: false, login: null },
          sameCoDevUser: false,
          hasPassword: false,
        }}
        user={{ id: "user-1", name: "Yousef" }}
      />,
    );

    expect(screen.getAllByText("Not connected")).toHaveLength(2);
    expect(
      screen.queryByText(
        "Google and GitHub are connected to this same CoDev account.",
      ),
    ).not.toBeInTheDocument();
  });
});
