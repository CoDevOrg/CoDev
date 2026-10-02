import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import type { EnvironmentVariable } from "@codev/contracts";

import { EnvironmentVariablesPanel } from "./environment-variables-panel";

function variable(name: string, lastFour = "1234"): EnvironmentVariable {
  return {
    id: `id-${name}`,
    name,
    lastFour,
    createdAt: "2026-09-20T20:00:00.000Z",
    updatedAt: "2026-09-20T20:00:00.000Z",
  };
}

function created(name: string) {
  return new Response(JSON.stringify({ variable: variable(name) }), {
    status: 201,
  });
}

describe("EnvironmentVariablesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains the empty state and offers both ways to add", () => {
    render(<EnvironmentVariablesPanel initialVariables={[]} />);
    expect(screen.getByText("No variables yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add variable/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Paste .env/ }),
    ).toBeInTheDocument();
  });

  it("rejects an invalid name as you type", () => {
    render(<EnvironmentVariablesPanel initialVariables={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Add variable/ }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "1abc" },
    });
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "x" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A name cannot start with a number.",
    );
    expect(
      screen.getByRole("button", { name: "Save variable" }),
    ).toBeDisabled();
  });

  it("imports a pasted .env and reports what it skipped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        created(JSON.parse(String(init.body)).name),
      ),
    );
    render(<EnvironmentVariablesPanel initialVariables={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Paste .env/ }));
    fireEvent.change(screen.getByLabelText("Paste your .env"), {
      target: {
        value: "# db\nDATABASE_URL=postgres://x\nnot valid\nAPI_KEY=abc",
      },
    });
    expect(screen.getByText(/2 variables ready; line 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import variables" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("Imported 2 variables."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Environment variables" }),
    ).toHaveTextContent("API_KEY");
  });

  it("deletes only after confirmation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EnvironmentVariablesPanel initialVariables={[variable("TOKEN")]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete TOKEN" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Delete TOKEN?");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete variable" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/environment/id-TOKEN",
        { method: "DELETE" },
      ),
    );
    expect(await screen.findByText("TOKEN deleted.")).toBeInTheDocument();
  });
});
