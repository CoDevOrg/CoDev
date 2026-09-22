import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Gen2AgentExecutionPolicySection } from "./agent-execution-policy-section";

const workspaceId = "11111111-1111-4111-8111-111111111111";

const capabilities = {
  "workspace.view": true,
  "workspace.editFiles": true,
  "workspace.useTerminal": true,
  "instance.start": true,
  "instance.stop": false,
  "agent.run": true,
  "agent.cancelOwn": true,
  "agent.cancelAny": false,
  "context.view": true,
  "context.includeInTurn": true,
  "member.invite": false,
  "member.changeRole": false,
  "member.remove": false,
  "workspace.managePolicy": true,
  "connection.manageOwn": true,
  "connection.viewStatus": false,
} as const;

describe("Gen 2 agent execution policy settings", () => {
  it("shows the effective policy and saves only through the policy API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ policy: { allowFileChanges: false } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ policy: { allowFileChanges: true } })),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Gen2AgentExecutionPolicySection
        capabilities={capabilities}
        workspaceId={workspaceId}
      />,
    );

    expect(
      await screen.findByText("Read-only", { selector: "span" }),
    ).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", {
      name: "Allow file changes",
    });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        `/api/gen2/workspaces/${workspaceId}/policy`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ allowFileChanges: true }),
        }),
      ),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("shows the effective policy but does not expose a save control to readers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ policy: { allowFileChanges: true } })),
        ),
    );

    render(
      <Gen2AgentExecutionPolicySection
        capabilities={{ ...capabilities, "workspace.managePolicy": false }}
        workspaceId={workspaceId}
      />,
    );

    expect(await screen.findByText("File changes allowed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(
      screen.getByText(/Only members with the workspace\.managePolicy/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("keeps the changed value available when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ policy: { allowFileChanges: false } })),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Policy update was denied." }), {
            status: 403,
          }),
        ),
    );

    render(
      <Gen2AgentExecutionPolicySection
        capabilities={capabilities}
        workspaceId={workspaceId}
      />,
    );

    const checkbox = await screen.findByRole("checkbox", {
      name: "Allow file changes",
    });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Policy update was denied.",
    );
    expect(checkbox).toBeChecked();
  });
});
