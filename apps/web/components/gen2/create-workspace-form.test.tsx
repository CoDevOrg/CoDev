import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

import { CreateGen2WorkspaceForm } from "./create-workspace-form";

describe("CreateGen2WorkspaceForm", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          workspace: { id: "11111111-1111-4111-8111-111111111111" },
        }),
      }),
    );
  });

  it("creates a workspace and opens it", async () => {
    render(<CreateGen2WorkspaceForm />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/gen2/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Studio" }),
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/gen2/11111111-1111-4111-8111-111111111111",
    );
  });
});
