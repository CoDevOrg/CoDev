import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSettingsDialog } from "./workspace-settings-dialog";
import { toProviderConnectionSnapshot } from "@/lib/providers/provider-connection-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const SNAPSHOT = toProviderConnectionSnapshot({
  viewer: { id: "member", name: "Member" },
  statuses: {},
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderDialog(onProvidersChanged = vi.fn()) {
  render(
    <WorkspaceSettingsDialog
      onOpenChange={vi.fn()}
      onProvidersChanged={onProvidersChanged}
      open
    />,
  );
  return onProvidersChanged;
}

describe("WorkspaceSettingsDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the member's accounts into the same cards as the settings page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    for (const name of ["Claude", "Codex", "Cursor"]) {
      expect(await screen.findByRole("heading", { name })).toBeInTheDocument();
    }
    expect(fetchMock).toHaveBeenCalledWith("/api/personal/connections", {
      cache: "no-store",
    });
  });

  it("tells the workspace when an account changes and reloads the cards", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);
    const onProvidersChanged = renderDialog();

    fireEvent.change(await screen.findByLabelText("Anthropic API key"), {
      target: { value: "sk-ant-test-key-0000000000" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save key" })[0]!);

    await waitFor(() => expect(onProvidersChanged).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/personal/connections",
      expect.objectContaining({ method: "PUT" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (init as RequestInit).cache === "no-store",
        ),
      ).toHaveLength(2),
    );
  });

  it("offers a retry when the accounts cannot be loaded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "down" }, 502))
      .mockResolvedValue(json(SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Claude" }),
    ).toBeInTheDocument();
  });
});
