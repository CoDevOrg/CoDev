import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2File } from "@codev/contracts";

// CodeMirror needs layout jsdom cannot provide. Stand it in with a textarea
// that speaks the same props, so the pane's own logic is what is tested.
vi.mock("./code-editor", () => ({
  Gen2CodeEditor: ({
    initialDoc,
    readOnly,
    onChange,
  }: {
    initialDoc: string;
    readOnly: boolean;
    onChange: (doc: string) => void;
  }) => (
    <textarea
      aria-label="Editor"
      defaultValue={initialDoc}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const { Gen2EditorPane } = await import("./editor-pane");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const file: Gen2File = { path: "a.ts", contents: "one", revision: "r1" };

/** The editor arrives through `next/dynamic`, so wait for it before typing. */
async function type(value: string) {
  const editor = await screen.findByLabelText("Editor");
  fireEvent.change(editor, { target: { value } });
}

describe("Gen2EditorPane", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ revision: "r2" }), { status: 200 }),
      ),
    );
  });

  it("invites the member to open something when nothing is open", () => {
    render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={null}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("Select a file to open it.")).toBeInTheDocument();
  });

  it("saves with the revision it loaded, so a stale write is caught", async () => {
    const onSaved = vi.fn();
    render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={file}
        agentRunning={false}
        onSaved={onSaved}
      />,
    );
    await type("two");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      `/api/gen2/workspaces/${workspaceId}/files`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          path: "a.ts",
          contents: "two",
          expectedRevision: "r1",
        }),
      }),
    );
  });

  it("takes an agent edit silently when the buffer is clean", async () => {
    const { rerender } = render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={file}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    await screen.findByLabelText("Editor");
    rerender(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={{ ...file, contents: "codex wrote this", revision: "r9" }}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("Updated by Codex")).toBeInTheDocument();
    expect(screen.queryByText(/changed on the machine/)).toBeNull();
  });

  it("will not discard unsaved work when the agent edits the same file", async () => {
    const { rerender } = render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={file}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    await type("mine");
    rerender(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={{ ...file, contents: "theirs", revision: "r9" }}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("This file changed on the machine.")).toBeVisible();
    expect(screen.getByLabelText("Editor")).toHaveValue("mine");
  });

  it("treats an emptied buffer as unsaved work, not as no work", async () => {
    // Deleting every line is an edit. An earlier draft-vs-empty check read it
    // as "nothing to lose" and let an incoming change overwrite it.
    const { rerender } = render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={file}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    await type("");
    rerender(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={{ ...file, contents: "theirs", revision: "r9" }}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("This file changed on the machine.")).toBeVisible();
  });

  it("surfaces a rejected save as the same conflict choice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "stale",
              code: "revision_mismatch",
              currentRevision: "r9",
            }),
            { status: 409 },
          ),
      ),
    );
    render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={file}
        agentRunning={false}
        onSaved={vi.fn()}
      />,
    );
    await type("two");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This file changed on the machine."),
    ).toBeVisible();
  });

  it("pauses saving while Codex holds the machine", async () => {
    render(
      <Gen2EditorPane
        workspaceId={workspaceId}
        file={file}
        agentRunning
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(await screen.findByLabelText("Editor")).toHaveAttribute("readonly");
    expect(screen.getByText(/saving is paused/)).toBeInTheDocument();
  });
});
