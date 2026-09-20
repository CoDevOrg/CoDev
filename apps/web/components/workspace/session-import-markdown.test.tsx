import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionImportMarkdown } from "./session-import-markdown";

describe("imported session Markdown", () => {
  it("renders conversation structure and code as readable elements", () => {
    const { container } = render(
      <SessionImportMarkdown
        text={
          "## Plan\n\n- Inspect the repo\n- Run tests\n\n```ts\nconst ready = true;\n```\n\n| Step | State |\n| --- | --- |\n| Tests | Passed |"
        }
      />,
    );

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveTextContent("Inspect the repo");
    expect(container.querySelector("pre code")).toHaveTextContent(
      "const ready = true;",
    );
    expect(screen.getByRole("table")).toHaveTextContent("TestsPassed");
  });

  it("does not load imported images or activate unsafe links and HTML", () => {
    const { container } = render(
      <SessionImportMarkdown
        text={
          "![private](https://tracker.example/pixel)\n\n[unsafe](javascript:alert(1)) [safe](https://example.com)\n\n<script>alert(1)</script>"
        }
      />,
    );

    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByText("[Image: private]")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
});
