import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

import { CreateGen2WorkspaceForm } from "./create-workspace-form";

const REPOS = [
  { id: 7, full_name: "ada/looms", private: true, default_branch: "main" },
  { id: 8, full_name: "ada/cards", private: false, default_branch: "trunk" },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith("/repositories")) return json({ repositories: REPOS });
      if (path.endsWith("/installations")) {
        return json({
          installations: [{ id: 1, account: { login: "ada", avatar_url: "" } }],
        });
      }
      return new Response(JSON.stringify({ workspace: { id: "ws-1" } }), {
        status: 201,
      });
    }),
  );
}

describe("CreateGen2WorkspaceForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetch();
  });

  it("creates a blank workspace and opens it", async () => {
    render(<CreateGen2WorkspaceForm githubConnected={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Blank workspace/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/gen2/ws-1"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/gen2/workspaces",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("offers GitHub when it is not connected yet", () => {
    render(<CreateGen2WorkspaceForm githubConnected={false} />);
    expect(
      screen.getByRole("button", { name: /Connect GitHub/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Search repositories")).toBeNull();
  });

  it("lists repositories once GitHub is connected", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    expect(await screen.findByText("ada/looms")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("trunk")).toBeInTheDocument();
  });

  it("filters the list as you type", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    await screen.findByText("ada/looms");
    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "card" },
    });
    expect(screen.queryByText("ada/looms")).toBeNull();
    expect(screen.getByText("ada/cards")).toBeInTheDocument();
  });

  it("creates from the repository that was picked", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    fireEvent.click(await screen.findByRole("button", { name: /ada\/looms/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/gen2/ws-1"));
    // The browser sends ids only; the control plane resolves the commit and
    // fetches the source, so no repository contents pass through here.
    expect(fetch).toHaveBeenCalledWith(
      "/api/gen2/workspaces",
      expect.objectContaining({
        body: JSON.stringify({ installationId: 1, repositoryId: 7 }),
      }),
    );
  });

  it("reports a create failure instead of navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Out of capacity." }), {
            status: 500,
          }),
      ),
    );
    render(<CreateGen2WorkspaceForm githubConnected={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Blank workspace/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Out of capacity.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
