import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Gen2FileTree } from "./file-tree";

describe("Gen2FileTree", () => {
  it("nests directories and opens the file that is clicked", () => {
    const onOpen = vi.fn();
    render(
      <Gen2FileTree
        files={[
          { path: "README.md", status: null },
          { path: "src/a.ts", status: "M" },
        ]}
        openPath={null}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole("treeitem", { name: /src/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /a\.ts/ }));
    expect(onOpen).toHaveBeenCalledWith("src/a.ts");
  });

  it("shows the git status beside a changed file", () => {
    render(
      <Gen2FileTree
        files={[{ path: "a.ts", status: "??" }]}
        openPath={null}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Untracked")).toBeInTheDocument();
  });

  it("marks the open file as selected", () => {
    render(
      <Gen2FileTree
        files={[{ path: "a.ts", status: null }]}
        openPath="a.ts"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("treeitem", { name: /a\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("collapses a directory when its row is clicked", () => {
    render(
      <Gen2FileTree
        files={[{ path: "src/a.ts", status: null }]}
        openPath={null}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: /src/ }));
    expect(screen.queryByRole("treeitem", { name: /a\.ts/ })).toBeNull();
  });

  it("says so when the machine has no files", () => {
    render(<Gen2FileTree files={[]} openPath={null} onOpen={vi.fn()} />);
    expect(screen.getByText("No files yet.")).toBeInTheDocument();
  });
});
