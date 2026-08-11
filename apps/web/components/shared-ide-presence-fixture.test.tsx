import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharedIdePresenceFixture } from "./shared-ide-presence-fixture";

describe("SharedIdePresenceFixture", () => {
  it("updates the other fixture's named active-file state when Alex switches files", () => {
    render(<SharedIdePresenceFixture />);

    expect(screen.getByLabelText("Alex Morgan IDE presence")).toHaveTextContent(
      "present · editing",
    );
    expect(screen.getByLabelText("Jordan Lee IDE presence")).toHaveTextContent(
      "present · observing",
    );
    expect(
      screen.getByLabelText("Jordan Lee active-file observation"),
    ).toHaveTextContent("src/hello.ts");

    fireEvent.click(
      screen
        .getByLabelText("Alex Morgan file navigator")
        .querySelector('button[aria-pressed="false"]')!,
    );

    expect(
      screen.getByLabelText("Jordan Lee active-file observation"),
    ).toHaveTextContent("README.md");
    expect(
      screen.getByRole("status", {
        name: "Jordan Lee active-file observation",
      }),
    ).toHaveTextContent("Alex Morgan is viewing README.md");
    expect(screen.getByLabelText("Shared editor content")).toHaveTextContent(
      "# CoDev fixture",
    );
  });
});
