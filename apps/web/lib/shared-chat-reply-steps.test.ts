import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), fail: vi.fn() }));
vi.mock("@/lib/shared-chat-reply", () => ({
  prepareRoomReply: mocks.prepare,
  failRoomReply: mocks.fail,
}));
import { prepareReplyStep } from "@/workflows/shared-chat-reply-steps";

it("persists a classified failure without serializing the raw SDK error", async () => {
  const error = new Error("private provider request");
  mocks.prepare.mockRejectedValue(error);
  await expect(prepareReplyStep("reply")).resolves.toBeNull();
  expect(mocks.fail).toHaveBeenCalledWith("reply", error);
});
