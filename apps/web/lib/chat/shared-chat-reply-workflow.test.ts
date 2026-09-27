import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  poll: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  cleanup: vi.fn(),
  publishPartial: vi.fn(),
}));
vi.mock("@/workflows/shared-chat-reply-steps", () => ({
  prepareReplyStep: mocks.prepare,
  pollReplyStep: mocks.poll,
  finishReplyStep: mocks.finish,
  failReplyStep: mocks.fail,
  cleanupReplyStep: mocks.cleanup,
  publishPartialReplyStep: mocks.publishPartial,
}));
import { sharedChatReplyWorkflow } from "@/workflows/shared-chat-reply";
beforeEach(() => {
  vi.resetAllMocks();
});
describe("durable room reply workflow", () => {
  it("finishes SDK replies without sandbox polling", async () => {
    mocks.prepare.mockResolvedValue(null);
    await sharedChatReplyWorkflow("reply");
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("decodes split UTF-8 output and cleans up after final persistence", async () => {
    mocks.prepare.mockResolvedValue({
      sessionId: "exec",
      credentialId: "seat",
    });
    const bytes = Buffer.from("Hello 🌍");
    mocks.poll.mockResolvedValueOnce({
      chunks: [{ dataBase64: bytes.subarray(0, 8).toString("base64") }],
      nextSequence: 1,
      exited: false,
    });
    mocks.poll.mockResolvedValueOnce({
      chunks: [{ dataBase64: bytes.subarray(8).toString("base64") }],
      nextSequence: 2,
      exited: true,
      exitCode: 0,
    });
    await sharedChatReplyWorkflow("reply");
    expect(mocks.poll).toHaveBeenLastCalledWith("reply", "exec", "seat", 1);
    expect(mocks.finish).toHaveBeenCalledWith("reply", "Hello 🌍", 0);
    expect(mocks.cleanup).toHaveBeenCalledWith("reply", "seat", "exec");
  });
  it("streams partial text to the room once enough has accumulated", async () => {
    mocks.prepare.mockResolvedValue({
      sessionId: "exec",
      credentialId: "seat",
      provider: "claude",
    });
    const delta = (text: string) =>
      `${JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { text } },
      })}\n`;
    const chunk = (text: string, exited: boolean, sequence: number) => ({
      chunks: [{ dataBase64: Buffer.from(text).toString("base64") }],
      nextSequence: sequence,
      exited,
      ...(exited ? { exitCode: 0 } : {}),
    });

    // Below the growth threshold: the room is not woken for a few characters.
    mocks.poll.mockResolvedValueOnce(chunk(delta("Short."), false, 1));
    // Crossing it publishes what has been written so far.
    mocks.poll.mockResolvedValueOnce(chunk(delta("x".repeat(200)), false, 2));
    mocks.poll.mockResolvedValueOnce(
      chunk(
        `${JSON.stringify({ type: "result", result: "Final." })}\n`,
        true,
        3,
      ),
    );

    await sharedChatReplyWorkflow("reply");

    expect(mocks.publishPartial).toHaveBeenCalledTimes(1);
    expect(mocks.publishPartial).toHaveBeenCalledWith(
      "reply",
      `Short.${"x".repeat(200)}`,
    );
    // The committed reply still comes from the authoritative final parse.
    expect(mocks.finish).toHaveBeenCalledWith(
      "reply",
      expect.stringContaining('"result":"Final."'),
      0,
    );
  });
  it("never publishes partials for a provider whose events are unrecognized", async () => {
    mocks.prepare.mockResolvedValue({
      sessionId: "exec",
      credentialId: "seat",
      provider: "codex",
    });
    mocks.poll.mockResolvedValueOnce({
      chunks: [{ dataBase64: Buffer.from("x".repeat(500)).toString("base64") }],
      nextSequence: 1,
      exited: false,
    });
    mocks.poll.mockResolvedValueOnce({
      chunks: [],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
    });
    await sharedChatReplyWorkflow("reply");
    expect(mocks.publishPartial).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalled();
  });
  it("persists a safe failure and cleans up after polling errors", async () => {
    mocks.prepare.mockResolvedValue({
      sessionId: "exec",
      credentialId: "seat",
    });
    mocks.poll.mockRejectedValue(new Error("private diagnostic"));
    await sharedChatReplyWorkflow("reply");
    expect(mocks.fail).toHaveBeenCalledWith("reply");
    expect(mocks.cleanup).toHaveBeenCalledWith("reply", "seat", "exec");
  });
});
