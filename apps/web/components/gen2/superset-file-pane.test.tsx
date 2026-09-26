import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  changes: vi.fn(),
}));

vi.mock("./superset-file-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./superset-file-client")>()),
  listSupersetFiles: mocks.list,
  readSupersetFile: mocks.read,
  saveSupersetFile: mocks.save,
  listSupersetFileChanges: mocks.changes,
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
    mocks.read.mockImplementation(async (_id: string, path: string) =>
      path === firstFile.path ? firstFile : secondFile,
    );
    mocks.save.mockImplementation(
      async (_id: string, file: typeof firstFile, contents: string) => ({
        ...file,
        contents,
        revision: "rev-2",
      }),
    );
    mocks.changes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads workspace files, opens a file, and saves with its revision", async () => {
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);

    expect(await screen.findByLabelText("Code")).toHaveValue(
      firstFile.contents,
    );
    expect(mocks.list).toHaveBeenCalledWith(
      workspaceId,
      expect.any(AbortSignal),
    );
    expect(mocks.read).toHaveBeenCalledWith(
      workspaceId,
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
        expect.objectContaining({ path: firstFile.path, revision: "rev-1" }),
        "export const live = true;",
      ),
    );
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent(
      "File saved.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
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

  it("flags an external change while the current file has unsaved edits", async () => {
    let poll: (() => void) | undefined;
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      if (delay === 10_000) poll = callback as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    render(<SupersetFilePane workspaceId={workspaceId} canEdit />);
    fireEvent.change(await screen.findByLabelText("Code"), {
      target: { value: "keep this draft" },
    });
    mocks.changes.mockResolvedValueOnce([
      {
        type: "file.changed",
        worktreeId: "main",
        path: firstFile.path,
        revision: "rev-2",
        origin: "external",
      },
    ]);

    act(() => poll?.());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "changed elsewhere",
    );
    expect(screen.getByLabelText("Code")).toHaveValue("keep this draft");
    expect(
      screen.getByRole("button", { name: "Copy changes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows a read-only editor to workspace viewers", async () => {
    render(<SupersetFilePane workspaceId={workspaceId} canEdit={false} />);
    expect(await screen.findByLabelText("Code")).toHaveAttribute("readonly");
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
