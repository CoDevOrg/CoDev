import { beforeEach, describe, expect, it } from "vitest";

import { readStoredChatTurn, rememberChatTurn } from "./chat-turn-storage";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const turn = {
  chatId: "chat-1",
  sessionId: "session-1",
  after: 3,
  provider: "claude" as const,
  actionNonce: "abcde12345",
};

describe("chat turn storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips the turn with its action token", () => {
    rememberChatTurn(WORKSPACE, turn);
    expect(readStoredChatTurn(WORKSPACE)).toEqual(turn);
    rememberChatTurn(WORKSPACE, null);
    expect(readStoredChatTurn(WORKSPACE)).toBeNull();
  });

  it("drops a malformed token and keeps turns saved before tokens existed", () => {
    sessionStorage.setItem(
      `codev-gen2-turn:${WORKSPACE}`,
      JSON.stringify({ ...turn, actionNonce: "NOT-A-TOKEN" }),
    );
    expect(readStoredChatTurn(WORKSPACE)?.actionNonce).toBeNull();
    const { actionNonce, ...legacy } = turn;
    void actionNonce;
    sessionStorage.setItem(
      `codev-gen2-turn:${WORKSPACE}`,
      JSON.stringify(legacy),
    );
    expect(readStoredChatTurn(WORKSPACE)).toEqual({
      ...legacy,
      actionNonce: null,
    });
  });

  it("ignores records for unknown providers or unreadable JSON", () => {
    sessionStorage.setItem(
      `codev-gen2-turn:${WORKSPACE}`,
      JSON.stringify({ ...turn, provider: "gemini" }),
    );
    expect(readStoredChatTurn(WORKSPACE)).toBeNull();
    sessionStorage.setItem(`codev-gen2-turn:${WORKSPACE}`, "{");
    expect(readStoredChatTurn(WORKSPACE)).toBeNull();
  });
});
