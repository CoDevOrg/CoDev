import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepositoryPicker } from "./repository-picker";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/app/actions/github", () => ({
  connectGitHubAccount: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

function stubGitHub() {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/github/installations") {
        return Response.json({
          login: "yousef20920",
          installations: [
            { id: 10, account: { login: "yousef20920", type: "User" } },
            { id: 20, account: { login: "CoDevOrg", type: "Organization" } },
            { id: 30, account: { login: "Marwanyx", type: "User" } },
          ],
        });
      }
      if (url.endsWith("/10/repositories")) {
        return Response.json({
          repositories: [
            { id: 101, full_name: "yousef20920/notes", private: true },
          ],
        });
      }
      if (url.endsWith("/20/repositories")) {
        return Response.json({
          repositories: [{ id: 202, full_name: "CoDevOrg/web", private: true }],
        });
      }
      if (url.endsWith("/30/repositories")) {
        return Response.json({
          repositories: [
            { id: 303, full_name: "Marwanyx/lab", private: false },
          ],
        });
      }
      if (url === "/api/workspaces" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          installationId: 30,
          repositoryId: 303,
        });
        return Response.json(
          { workspace: { id: "workspace-1" } },
          { status: 201 },
        );
      }
      return Response.json({ error: "Unexpected request" }, { status: 500 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openAccountList() {
  render(
    <RepositoryPicker appSlug="codev" githubAuthConfigured githubConnected />,
  );
  fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
  return await screen.findByRole("combobox", { name: /Installation/ });
}

describe("RepositoryPicker", () => {
  it("offers only accounts the member owns", async () => {
    stubGitHub();
    const accounts = await openAccountList();

    await waitFor(() =>
      expect(screen.getByText("yousef20920 · Your account")).toBeTruthy(),
    );
    expect(screen.getByText("CoDevOrg · Organization")).toBeTruthy();
    expect(screen.queryByText(/Marwanyx ·/)).toBeNull();
    expect(accounts).toBeTruthy();
  });

  it("folds repositories shared by other owners into the member's account", async () => {
    stubGitHub();
    const accounts = await openAccountList();

    await waitFor(() =>
      expect(screen.getByText("yousef20920 · Your account")).toBeTruthy(),
    );
    fireEvent.change(accounts, { target: { value: "10" } });

    const shared = await screen.findByText("Marwanyx/lab · shared by Marwanyx");
    expect(screen.getByText("Private · yousef20920/notes")).toBeTruthy();
    expect(screen.queryByText(/CoDevOrg\/web/)).toBeNull();

    const repositories = screen.getByRole("combobox", { name: /Repository/ });
    fireEvent.change(repositories, { target: { value: "30:303" } });
    fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/workspaces/workspace-1"),
    );
    expect(shared).toBeTruthy();
  });
});
