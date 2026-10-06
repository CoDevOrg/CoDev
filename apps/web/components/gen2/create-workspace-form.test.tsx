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

async function openRepositories() {
  fireEvent.click(screen.getByRole("radio", { name: /GitHub repository/ }));
  return screen.findByText("ada/looms");
}

describe("CreateGen2WorkspaceForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetch();
  });

  it("creates nothing until Create is pressed", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    await openRepositories();
    fireEvent.click(screen.getByRole("button", { name: /ada\/looms/ }));
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/gen2/workspaces",
      expect.anything(),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("creates a blank workspace and opens it", async () => {
    render(<CreateGen2WorkspaceForm githubConnected={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/gen2/ws-1"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/gen2/workspaces",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("sends the optional name", async () => {
    render(<CreateGen2WorkspaceForm githubConnected={false} />);
    fireEvent.change(screen.getByLabelText("Name (optional)"), {
      target: { value: "  Studio  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/gen2/workspaces",
      expect.objectContaining({ body: JSON.stringify({ name: "Studio" }) }),
    );
  });

  it("always shows how many workspaces are used", () => {
    render(
      <CreateGen2WorkspaceForm
        githubConnected={false}
        ownedWorkspaceCount={1}
      />,
    );
    expect(screen.getByText("1 of 1 used")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("blocks workspace creation when the owner limit is reached", () => {
    render(
      <CreateGen2WorkspaceForm
        githubConnected={false}
        ownedWorkspaceCount={1}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Create workspace" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You own 1 of 1 Gen 2 workspaces. Delete one or change plans to create another.",
    );
  });

  it("offers GitHub when it is not connected yet", () => {
    render(<CreateGen2WorkspaceForm githubConnected={false} />);
    fireEvent.click(screen.getByRole("radio", { name: /GitHub repository/ }));
    expect(
      screen.getByRole("button", { name: /Connect GitHub/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Search repositories")).toBeNull();
  });

  it("lists repositories with a heading once GitHub is chosen", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    expect(await openRepositories()).toBeInTheDocument();
    expect(screen.getByText("Your repositories")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("trunk")).toBeInTheDocument();
    expect(screen.getByText("2 repositories")).toBeInTheDocument();
  });

  it("filters the list as you type", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    await openRepositories();
    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "card" },
    });
    expect(screen.queryByText("ada/looms")).toBeNull();
    expect(screen.getByText("ada/cards")).toBeInTheDocument();
  });

  it("says when the list is cut off", async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      id: index + 1,
      full_name: `ada/repo-${index}`,
      private: false,
      default_branch: "main",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.endsWith("/repositories")) {
          return new Response(JSON.stringify({ repositories: many }));
        }
        return new Response(
          JSON.stringify({
            installations: [
              { id: 1, account: { login: "ada", avatar_url: "" } },
            ],
          }),
        );
      }),
    );
    render(<CreateGen2WorkspaceForm githubConnected />);
    fireEvent.click(screen.getByRole("radio", { name: /GitHub repository/ }));
    expect(await screen.findByText(/Showing 40 of 45/)).toBeInTheDocument();
  });

  it("creates from the repository that was picked", async () => {
    render(<CreateGen2WorkspaceForm githubConnected />);
    await openRepositories();
    const create = screen.getByRole("button", { name: "Create workspace" });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /ada\/looms/ }));
    fireEvent.click(create);
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

  it("shows a retryable error when GitHub cannot be reached", async () => {
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.endsWith("/installations")) {
          return failing
            ? new Response("{}", { status: 502 })
            : new Response(
                JSON.stringify({
                  installations: [
                    { id: 1, account: { login: "ada", avatar_url: "" } },
                  ],
                }),
              );
        }
        return new Response(JSON.stringify({ repositories: REPOS }));
      }),
    );
    render(<CreateGen2WorkspaceForm githubConnected />);
    fireEvent.click(screen.getByRole("radio", { name: /GitHub repository/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn\u2019t load your repositories",
    );

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("ada/looms")).toBeInTheDocument();
  });

  it("creates shared repositories using their source installation", async () => {
    const shared = {
      ...REPOS[0],
      full_name: "friend/shared",
      installationId: 99,
      sharedWith: ["friend", "grace"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/installations"))
          return Response.json({
            installations: [{ id: 1, account: { login: "ada" } }],
          });
        if (url.endsWith("/repositories"))
          return Response.json({ repositories: [shared] });
        return Response.json({ workspace: { id: "ws-1" } });
      }),
    );
    render(<CreateGen2WorkspaceForm githubConnected />);
    fireEvent.click(screen.getByRole("radio", { name: /GitHub repository/ }));
    expect(
      await screen.findByText("Shared with @friend, @grace"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /friend\/shared/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/gen2/ws-1"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/gen2/workspaces",
      expect.objectContaining({
        body: JSON.stringify({ installationId: 99, repositoryId: 7 }),
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
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Out of capacity.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
