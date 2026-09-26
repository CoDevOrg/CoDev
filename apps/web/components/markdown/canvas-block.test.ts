import { describe, expect, it } from "vitest";

import { parseCanvasBlock } from "./canvas-block";

describe("parseCanvasBlock", () => {
  it("extracts the variant, attributes, and inner content", () => {
    const text =
      ':::writing{variant="email" id="48317" subject="Deferral Request"} Hi,\n\nThank you for outlining the deferral process.\n\nBest,\nKhaled Ismail :::';

    expect(parseCanvasBlock(text)).toEqual({
      variant: "writing",
      attributes: {
        variant: "email",
        id: "48317",
        subject: "Deferral Request",
      },
      content:
        "Hi,\n\nThank you for outlining the deferral process.\n\nBest,\nKhaled Ismail",
    });
  });

  it("returns null for plain text without a canvas wrapper", () => {
    expect(parseCanvasBlock("Just a normal message.")).toBeNull();
  });

  it("returns null when there is no attribute block", () => {
    const text = ":::writing content here :::";
    const result = parseCanvasBlock(text);
    expect(result?.variant).toBe("writing");
    expect(result?.content).toBe("content here");
    expect(result?.attributes).toEqual({});
  });
});
