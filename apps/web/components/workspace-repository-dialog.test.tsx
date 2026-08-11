import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceRepositoryDialog } from "./workspace-repository-dialog";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

describe("WorkspaceRepositoryDialog", () => {
  it("loads every authorized installation and opens the selected repository", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/github/installations") {
          return Response.json({
            installations: [
              { id: 10, account: { login: "one", type: "User" } },
              { id: 20, account: { login: "two", type: "Organization" } },
            ],
          });
        }
        if (url.endsWith("/10/repositories")) {
          return Response.json({
            repositories: [
              { id: 101, full_name: "one/private", private: true },
            ],
          });
        }
        if (url.endsWith("/20/repositories")) {
          return Response.json({
            repositories: [
              { id: 202, full_name: "two/public", private: false },
            ],
          });
        }
        if (url === "/api/workspaces" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toEqual({
            installationId: 10,
            repositoryId: 101,
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

    render(<WorkspaceRepositoryDialog open onClose={vi.fn()} />);

    expect(await screen.findByText("one/private")).toBeTruthy();
    expect(screen.getByText("two/public")).toBeTruthy();
    fireEvent.click(screen.getByText("one/private"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/workspaces/workspace-1"),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
});
