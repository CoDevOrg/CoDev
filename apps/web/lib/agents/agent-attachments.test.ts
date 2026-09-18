import { describe, expect, it } from "vitest";

import {
  agentAttachmentsSchema,
  toStoredAgentAttachments,
} from "./agent-attachments";

describe("agent attachments", () => {
  it("accepts image data and preserves it for the agent runtime", () => {
    const parsed = agentAttachmentsSchema.parse([
      {
        name: "Screenshot.png",
        type: "image/png",
        size: 3,
        data: "AQI=",
      },
    ]);

    expect(toStoredAgentAttachments(parsed)).toEqual(parsed);
  });

  it("rejects image metadata without image data", () => {
    expect(() =>
      agentAttachmentsSchema.parse([
        { name: "Screenshot.png", type: "image/png", size: 3 },
      ]),
    ).toThrow(/Image data is required/);
  });

  it("rejects binary data for non-image attachments", () => {
    expect(() =>
      agentAttachmentsSchema.parse([
        {
          name: "archive.zip",
          type: "application/zip",
          size: 3,
          data: "AQI=",
        },
      ]),
    ).toThrow(/Only image attachments/);
  });
});
