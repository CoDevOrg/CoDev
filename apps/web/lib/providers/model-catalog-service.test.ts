import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ models: vi.fn() }));
vi.mock("./dynamic-models", () => ({
  getDynamicModelsForProvider: mocks.models,
}));
import { discoverAccountModelsForWorker } from "./model-catalog-service";
import { getRelayedCodexAccountModels } from "./model-catalog-relay";
const userId = "3d2adad2-6622-4448-a4d5-d9b4fc51f85e";
const models = [{ id: "plan-model", label: "Plan model" }];
function request(secret = "service-secret", provider = "codex") {
  return new Request("https://service/api/gen2/providers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId, provider }),
  });
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("CRON_SECRET", "service-secret");
  mocks.models.mockReset().mockResolvedValue(models);
});
it("requires service authorization before reading account credentials", async () => {
  await expect(
    discoverAccountModelsForWorker(request("wrong")),
  ).rejects.toMatchObject({ status: 401 });
  expect(mocks.models).not.toHaveBeenCalled();
});
it("returns only the requested member's discovered models", async () => {
  expect(await discoverAccountModelsForWorker(request())).toEqual({ models });
  expect(mocks.models).toHaveBeenCalledWith("codex", userId);
});
it("rejects unsupported providers and prevents relay loops on Workers", async () => {
  await expect(
    discoverAccountModelsForWorker(request("service-secret", "cursor")),
  ).rejects.toMatchObject({ status: 400 });
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  await expect(discoverAccountModelsForWorker(request())).rejects.toMatchObject(
    { status: 503 },
  );
  expect(mocks.models).not.toHaveBeenCalled();
});
it("never exposes credential/provider errors through the service", async () => {
  mocks.models.mockRejectedValue(new Error("private-token"));
  await expect(discoverAccountModelsForWorker(request())).rejects.toThrow(
    "Account model service unavailable.",
  );
});
it("relays only member identity to the fixed service with redirects refused", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ models }));
  expect(await getRelayedCodexAccountModels(userId)).toEqual(models);
  expect(fetch).toHaveBeenCalledWith(
    "https://codev-co-dev-admins.vercel.app/api/gen2/providers",
    expect.objectContaining({
      redirect: "manual",
      headers: expect.objectContaining({
        authorization: "Bearer service-secret",
      }),
      body: JSON.stringify({ userId, provider: "codex" }),
    }),
  );
});
