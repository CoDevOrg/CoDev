import { describe, expect, it } from "vitest";

import {
  channelSlugSchema,
  createChannelSchema,
  memberStatusSchema,
  mentionsAgent,
  parseMentionedLogins,
  postChannelMessageSchema,
} from "./team-chat";

describe("channel names", () => {
  it("accepts lowercase hyphenated names", () => {
    expect(channelSlugSchema.parse("deploys-2")).toBe("deploys-2");
  });

  it("rejects names people would mistype into an ambiguous channel", () => {
    for (const invalid of ["#general", "General", "with space", "-lead", ""]) {
      expect(() => channelSlugSchema.parse(invalid)).toThrow();
    }
  });

  it("defaults new channels to agent-readable without saying so", () => {
    expect(createChannelSchema.parse({ slug: "design" })).toEqual({
      slug: "design",
    });
  });
});

describe("message and status input", () => {
  it("trims a body and rejects an empty one", () => {
    expect(postChannelMessageSchema.parse({ body: "  hi  " })).toEqual({
      body: "hi",
    });
    expect(() => postChannelMessageSchema.parse({ body: "   " })).toThrow();
  });

  it("allows clearing a status back to nothing", () => {
    expect(memberStatusSchema.parse({ headline: null, emoji: null })).toEqual({
      headline: null,
      emoji: null,
    });
  });
});

describe("mentionsAgent", () => {
  it("matches the agent token as a word", () => {
    expect(mentionsAgent("@agent can you look at this?")).toBe(true);
    expect(mentionsAgent("hey @Agent")).toBe(true);
    expect(mentionsAgent("ping @agent, please")).toBe(true);
  });

  it("does not fire on lookalikes", () => {
    expect(mentionsAgent("email me at me@agent.io")).toBe(false);
    expect(mentionsAgent("the @agents channel")).toBe(false);
    expect(mentionsAgent("no mention here")).toBe(false);
  });
});

describe("parseMentionedLogins", () => {
  it("returns lowercase logins in first-appearance order", () => {
    expect(parseMentionedLogins("@Ada and @linus, then @ada again")).toEqual([
      "ada",
      "linus",
    ]);
  });

  it("skips the agent token and email addresses", () => {
    expect(parseMentionedLogins("@agent ping ada@example.com @ada")).toEqual([
      "ada",
    ]);
  });
});
