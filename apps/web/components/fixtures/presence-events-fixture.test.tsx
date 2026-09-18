import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PresenceEventsFixture } from "./presence-events-fixture";

describe("PresenceEventsFixture", () => {
  it("shows both fixtures and the durable file/cursor event stream", () => {
    render(<PresenceEventsFixture />);

    const joinButtons = screen.getAllByRole("button", { name: "Join file" });
    fireEvent.click(joinButtons[0]!);
    fireEvent.click(joinButtons[1]!);

    expect(
      screen.getByText(
        "Both fixtures are present in src/hello.ts with durable cursor state.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Alex Morgan presence")).toHaveTextContent(
      "present in file",
    );
    expect(screen.getByLabelText("Jordan Lee presence")).toHaveTextContent(
      "present in file",
    );
    expect(screen.getByLabelText("Durable presence events")).toHaveTextContent(
      "6 events",
    );
    expect(screen.getAllByText("presence.cursor.changed")).toHaveLength(2);
  });

  it("records a left event and shows the fixture offline", () => {
    render(<PresenceEventsFixture />);

    fireEvent.click(screen.getAllByRole("button", { name: "Join file" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Leave file" }));

    expect(screen.getByLabelText("Alex Morgan presence")).toHaveTextContent(
      "not joined",
    );
    expect(screen.getByLabelText("Durable presence events")).toHaveTextContent(
      "4 events",
    );
    expect(screen.getByText("presence.left")).toBeTruthy();
  });
});
