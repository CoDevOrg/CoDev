import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  poll: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/workflows/shared-chat-reply-steps", () => ({
  prepareReplyStep: mocks.prepare,
  pollReplyStep: mocks.poll,
  finishReplyStep: mocks.finish,
  failReplyStep: mocks.fail,
  cleanupReplyStep: mocks.cleanup,
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
