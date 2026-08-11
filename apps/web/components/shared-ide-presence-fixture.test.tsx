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
    expect(
      screen.getByLabelText("Jordan Lee remote selection"),
    ).toHaveTextContent("No remote text selected");
  });

  it("renders Alex's selected text in Jordan's shared view", () => {
    render(<SharedIdePresenceFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select hello function as Alex" }),
    );

    expect(
      screen.getByLabelText("Jordan Lee remote selection"),
    ).toHaveTextContent("Alex Morgan selected hello function · lines 1–3");
    expect(screen.getByText("export function hello() {")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));

    expect(
      screen.getByLabelText("Jordan Lee remote selection"),
    ).toHaveTextContent("No remote text selected");
  });

  it("replays presence and the current document after Jordan reconnects", () => {
    render(<SharedIdePresenceFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "tests/hello.test.ts" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Jordan" }));

    expect(screen.getByLabelText("Jordan Lee IDE presence")).toHaveTextContent(
      "offline · reconnecting",
    );
    expect(
      screen.getByLabelText("Jordan Lee active-file observation"),
    ).toHaveTextContent("tests/hello.test.ts");

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(
      screen.getByLabelText("Jordan Lee active-file observation"),
    ).toHaveTextContent("tests/hello.test.ts");

    fireEvent.click(screen.getByRole("button", { name: "Reconnect Jordan" }));

    expect(screen.getByLabelText("Jordan Lee IDE presence")).toHaveTextContent(
      "present · observing",
    );
    expect(
      screen.getByLabelText("Jordan Lee active-file observation"),
    ).toHaveTextContent("Alex Morgan is viewing README.md");
    expect(screen.getByLabelText("Shared editor content")).toHaveTextContent(
      "# CoDev fixture",
    );
    expect(screen.getByLabelText("Jordan reconnect state")).toHaveTextContent(
      "Presence and document state replayed",
    );
  });

  it("surfaces both versions when a terminal change conflicts with Alex's edit", () => {
    render(<SharedIdePresenceFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit hello function as Alex" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate terminal change" }),
    );

    expect(
      screen.getByLabelText("External file change conflict"),
    ).toHaveTextContent("No version was overwritten.");
    expect(
      screen.getByLabelText("Collaborative editor version"),
    ).toHaveTextContent('return "hello from Alex"');
    expect(
      screen.getByLabelText("External filesystem version"),
    ).toHaveTextContent('return "hello from terminal"');
    expect(
      screen.getByLabelText("Conflict resolution choices"),
    ).toHaveTextContent("Keep collaborative editor");
    expect(
      screen.getByLabelText("Conflict resolution choices"),
    ).toHaveTextContent("Use external filesystem");
  });
});
