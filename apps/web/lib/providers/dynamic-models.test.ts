import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  codex: vi.fn(),
  cursor: vi.fn(),
  claude: vi.fn(),
  relay: vi.fn(),
  fresh: vi.fn(),
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
vi.mock("./model-catalog-relay", () => ({
  getRelayedCodexAccountModels: mocks.relay,
}));
vi.mock("./codex-token-refresh", () => ({ freshCodexSecret: mocks.fresh }));
import {
  clearDynamicModelCache,
  getDynamicModelsForProvider,
} from "./dynamic-models";
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  clearDynamicModelCache();
  mocks.resolve.mockResolvedValue({
    secret: { kind: "api_key", apiKey: "private-a" },
  });
  mocks.codex.mockResolvedValue([{ id: "account-a", label: "Account A" }]);
  mocks.fresh.mockImplementation(async ({ secret }) => secret);
});
it("relays Worker Codex discovery without decrypting credentials on the Worker", async () => {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  const models = [{ id: "plan-model", label: "Plan model" }];
  mocks.relay.mockResolvedValue(models);
  expect(await getDynamicModelsForProvider("codex", "member-a")).toEqual(
    models,
  );
  expect(mocks.relay).toHaveBeenCalledWith("member-a");
  expect(mocks.resolve).not.toHaveBeenCalled();
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
it("discovers Codex models with a refreshed sign-in rather than the expired one", async () => {
  const stored = { kind: "codex_auth_cache", authCacheJson: "expired" };
  const renewed = { kind: "codex_auth_cache", authCacheJson: "renewed" };
  mocks.resolve.mockResolvedValue({
    credentialId: "credential-1",
    credentialRevision: "revision-1",
    secret: stored,
  });
  mocks.fresh.mockResolvedValue(renewed);
  await getDynamicModelsForProvider("codex", "member-a");
  expect(mocks.fresh).toHaveBeenCalledWith(
    expect.objectContaining({ credentialId: "credential-1", secret: stored }),
  );
  expect(mocks.codex).toHaveBeenCalledWith(renewed);
});
it("only refreshes Codex credentials", async () => {
  mocks.claude.mockResolvedValue([{ id: "claude-model", label: "Claude" }]);
  await getDynamicModelsForProvider("claude", "member-a");
  expect(mocks.fresh).not.toHaveBeenCalled();
});
