import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./superset-code-editor", () => ({
  SupersetCodeEditor: ({
    onChange,
    onSave,
  }: {
    onChange: (value: string) => void;
    onSave: () => void;
  }) => (
    <>
      <button type="button" onClick={() => onChange("edited")}>
        Edit sample
      </button>
      <button type="button" onClick={onSave}>
        Save sample
      </button>
    </>
  ),
}));

import { SupersetFilePane } from "./superset-file-pane";

describe("SupersetFilePane", () => {
  it("renders one hardcoded sample file without a backend request", () => {
    render(<SupersetFilePane />);

    expect(
      screen.getByRole("tree", { name: "Sample workspace files" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /greeting\.ts/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Sample file")).toBeInTheDocument();
  });

  it("makes sample-only saves explicit", () => {
    render(<SupersetFilePane />);

    fireEvent.click(screen.getByRole("button", { name: "Edit sample" }));
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sample mode — the file API is not connected yet.",
    );
  });
});
