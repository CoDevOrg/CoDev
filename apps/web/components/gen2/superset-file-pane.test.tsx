import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
}));

vi.mock("./superset-file-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./superset-file-client")>()),
  listSupersetFiles: mocks.list,
  readSupersetFile: mocks.read,
  saveSupersetFile: mocks.save,
  createSupersetEntry: mocks.create,
}));

vi.mock("./use-gen2-shared-file-document", () => ({
  useGen2SharedFileDocument: () => ({
    text: null,
    awareness: null,
    state: "connected",
    notice: null,
    members: [],
    updateCursor: vi.fn(),
    readOnly: false,
  }),
}));

vi.mock("./superset-code-editor", () => ({
  SupersetCodeEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (value: string) => void;
    readOnly: boolean;
  }) => (
    <textarea
      aria-label="Code"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { SupersetFileApiError } from "./superset-file-client";
import { SupersetFilePane } from "./superset-file-pane";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const firstFile = {
  path: "src/greeting.ts",
  kind: "file" as const,
  size: 13,
  contents: "export {};",
  revision: "rev-1",
};
const secondFile = {
  path: "README.md",
  kind: "file" as const,
  size: 6,
  contents: "# Read",
  revision: "rev-1",
};

describe("SupersetFilePane", () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue([firstFile, secondFile]);
    mocks.read.mockImplementation(
      async (_id: string, _worktree: string, path: string) =>
        path === firstFile.path ? firstFile : secondFile,
    );
    mocks.save.mockImplementation(
      async (
        _id: string,
        _worktree: string,
        file: typeof firstFile,
        contents: string,
      ) => ({
        ...file,
        contents,
        revision: "rev-2",
      }),
    );
    mocks.create.mockImplementation(
      async (
        _id: string,
        _worktree: string,
        input: {
          parentPath: string;
          name: string;
          kind: "file" | "directory";
        },
      ) =>
        input.kind === "file"
          ? { path: input.name, kind: "file", size: 0 }
          : { path: input.name, kind: "directory" },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("hides Git's linked-worktree pointer from the file tree", async () => {
    mocks.list.mockResolvedValue([
      { path: ".git", kind: "file", size: 57 },
      secondFile,
    ]);
    render(
      <SupersetFilePane
        workspaceId={workspaceId}
        worktreeId="test-2"
        canEdit
      />,
    );
    expect(
      await screen.findByRole("treeitem", { name: /README\.md/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: /^\.git$/ }),
    ).not.toBeInTheDocument();
  });

  it("loads workspace files, opens a file, and saves with its revision", async () => {
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);

    expect(await screen.findByLabelText("Code")).toHaveValue(
      firstFile.contents,
    );
    expect(mocks.list).toHaveBeenCalledWith(
      workspaceId,
      "main",
      expect.any(AbortSignal),
    );
    expect(mocks.read).toHaveBeenCalledWith(
      workspaceId,
      "main",
      firstFile.path,
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("treeitem", { name: /greeting\.ts/ }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "export const live = true;" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        workspaceId,
        "main",
        expect.objectContaining({ path: firstFile.path, revision: "rev-1" }),
        "export const live = true;",
      ),
    );
    expect(await screen.findByText("File saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("scopes file requests and the shared document to the selected worktree", async () => {
    render(
      <SupersetFilePane
        workspaceId={workspaceId}
        canEdit
        worktreeId="feature-auth"
      />,
    );

    await screen.findByLabelText("Code");
    expect(mocks.list).toHaveBeenCalledWith(
      workspaceId,
      "feature-auth",
      expect.any(AbortSignal),
    );
    expect(mocks.read).toHaveBeenCalledWith(
      workspaceId,
      "feature-auth",
      firstFile.path,
      expect.any(AbortSignal),
    );
  });

  it("preserves the draft and offers recovery when a save conflicts", async () => {
    mocks.save.mockRejectedValue(
      new SupersetFileApiError("This file changed.", 409, "rev-2"),
    );
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);
    fireEvent.change(await screen.findByLabelText("Code"), {
      target: { value: "my unsaved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your edits are safe here",
    );
    expect(screen.getByLabelText("Code")).toHaveValue("my unsaved draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.read.mockResolvedValueOnce({
      ...firstFile,
      contents: "external edit",
      revision: "rev-2",
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Code")).toHaveValue("external edit"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a read-only editor to workspace viewers", async () => {
    render(<SupersetFilePane workspaceId={workspaceId} canEdit={false} />);
    expect(await screen.findByLabelText("Code")).toHaveAttribute("readonly");
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New folder" })).toBeDisabled();
  });

  it("creates and opens a new root-level file", async () => {
    const newFile = {
      path: "notes.md",
      kind: "file" as const,
      size: 0,
      contents: "",
      revision: "rev-new",
    };
    mocks.read.mockImplementation(
      async (_id: string, _worktree: string, path: string) =>
        path === newFile.path
          ? newFile
          : path === firstFile.path
            ? firstFile
            : secondFile,
    );
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);
    await screen.findByLabelText("Code");

    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    const name = screen.getByLabelText("New file name");
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: newFile.path } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(workspaceId, "main", {
        parentPath: "",
        name: newFile.path,
        kind: "file",
      }),
    );
    await waitFor(() =>
      expect(mocks.read).toHaveBeenLastCalledWith(
        workspaceId,
        "main",
        newFile.path,
        undefined,
      ),
    );
    expect(
      await screen.findByText("File notes.md created."),
    ).toBeInTheDocument();
  });

  it("creates an empty folder without replacing an unsaved draft", async () => {
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);
    fireEvent.change(await screen.findByLabelText("Code"), {
      target: { value: "keep this draft" },
    });

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("New folder name"), {
      target: { value: "notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(workspaceId, "main", {
        parentPath: "",
        name: "notes",
        kind: "directory",
      }),
    );
    expect(
      await screen.findByText("Folder notes created."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toHaveValue("keep this draft");
  });

  it("opens a requested path from Changes or chat", async () => {
    const onConsumed = vi.fn();
    const { rerender } = render(
      <SupersetFilePane workspaceId={workspaceId} canEdit />,
    );
    await screen.findByLabelText("Code");
    rerender(
      <SupersetFilePane
        workspaceId={workspaceId}
        canEdit
        requestedPath={secondFile.path}
        onRequestedPathConsumed={onConsumed}
      />,
    );
    await waitFor(() =>
      expect(mocks.read).toHaveBeenLastCalledWith(
        workspaceId,
        "main",
        secondFile.path,
        undefined,
      ),
    );
    expect(onConsumed).toHaveBeenCalled();
    expect(
      screen.getByRole("treeitem", { name: /README\.md/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("keeps file-row actions in the tab order for keyboard users", async () => {
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);
    await screen.findByLabelText("Code");
    const trigger = screen.getByRole("button", {
      name: "Actions for src/greeting.ts",
    });
    expect(trigger).not.toBeDisabled();
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.pointerUp(trigger, { button: 0 });
    expect(
      await screen.findByRole("menuitem", { name: /Rename/ }),
    ).toBeInTheDocument();
  });
});
