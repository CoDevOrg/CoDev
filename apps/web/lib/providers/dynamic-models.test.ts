import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  codex: vi.fn(),
  cursor: vi.fn(),
  claude: vi.fn(),
}));
vi.mock("./resolve", () => ({ requireCredential: mocks.resolve }));
vi.mock("./codex-account-models", () => ({
  getCodexAccountModels: mocks.codex,
}));
vi.mock("./cursor-account-models", () => ({
  getCursorAccountModels: mocks.cursor,
}));
vi.mock("./claude-account-models", () => ({
  getClaudeAccountModels: mocks.claude,
}));
import {
  clearDynamicModelCache,
  getDynamicModelsForProvider,
} from "./dynamic-models";
beforeEach(() => {
  vi.resetAllMocks();
  clearDynamicModelCache();
  mocks.resolve.mockResolvedValue({
    secret: { kind: "api_key", apiKey: "private-a" },
  });
  mocks.codex.mockResolvedValue([{ id: "account-a", label: "Account A" }]);
});
it("caches an account catalog without sharing another member's results", async () => {
  await getDynamicModelsForProvider("codex", "member-a");
  await getDynamicModelsForProvider("codex", "member-a");
  expect(mocks.codex).toHaveBeenCalledTimes(1);
  await getDynamicModelsForProvider("codex", "member-b");
  expect(mocks.codex).toHaveBeenCalledTimes(2);
});
it("does not reuse the old plan catalog after reconnecting a credential", async () => {
  await getDynamicModelsForProvider("codex", "member-a");
  mocks.resolve.mockResolvedValue({
    secret: { kind: "api_key", apiKey: "private-b" },
  });
  mocks.codex.mockResolvedValue([{ id: "account-b", label: "Account B" }]);
  expect(await getDynamicModelsForProvider("codex", "member-a")).toEqual([
    { id: "account-b", label: "Account B" },
  ]);
});
it("never invents models on provider failure or an empty catalog", async () => {
  mocks.codex.mockRejectedValue(new Error("unavailable"));
  await expect(
    getDynamicModelsForProvider("codex", "member-a"),
  ).rejects.toThrow("unavailable");
  mocks.codex.mockResolvedValue([]);
  await expect(
    getDynamicModelsForProvider("codex", "member-a"),
  ).rejects.toThrow("No account models");
});
it("uses Cursor's account discovery instead of a public OpenAI catalog", async () => {
  mocks.cursor.mockResolvedValue([
    { id: "cursor-model", label: "Cursor model" },
  ]);
  expect(await getDynamicModelsForProvider("cursor", "member-a")).toEqual([
    { id: "cursor-model", label: "Cursor model" },
  ]);
  expect(mocks.codex).not.toHaveBeenCalled();
});
