import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  create: vi.fn(),
  status: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
import { armWorkflowBinding } from "./arm-workflow-binding";
import { dispatchArmWorkflow } from "./arm-workflow-bridge";
const params = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  operationId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  generation: 1,
  resourceGeneration: 1,
  cleanupGeneration: null,
  kind: "start" as const,
};
function request(
  method: string,
  authorization = "Bearer test-secret",
  body = params,
) {
  return new Request(
    `https://trycodev.com/api/gen2/compute/workflow?id=${params.operationId}`,
    {
      method,
      headers: { authorization },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    },
  );
}
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  mocks.env.GEN2_ARM_WORKSPACE_LIFECYCLE = {
    create: mocks.create,
    get: async () => ({ status: mocks.status }),
  };
  mocks.create.mockReset();
  mocks.status.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("ARM workflow bridge", () => {
  it("rejects unauthorized access before workflow creation", async () => {
    await expect(
      dispatchArmWorkflow(request("POST", "Bearer wrong")),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("dispatches validated operations and reads native status", async () => {
    await expect(dispatchArmWorkflow(request("POST"))).resolves.toEqual({
      queued: true,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      id: params.operationId,
      params,
    });
    mocks.status.mockResolvedValue({ status: "running" });
    await expect(dispatchArmWorkflow(request("GET"))).resolves.toEqual({
      status: "running",
    });
  });
  it("rejects malformed workflow parameters", async () => {
    await expect(
      dispatchArmWorkflow(
        request("POST", undefined, { ...params, generation: -1 }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("forwards Vercel dispatch and status with service authentication", async () => {
    delete mocks.env.GEN2_ARM_WORKSPACE_LIFECYCLE;
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ status: "running" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const binding = armWorkflowBinding();
    await binding.create({ id: params.operationId, params });
    await (await binding.get(params.operationId)).status();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
        }),
        body: JSON.stringify(params),
        redirect: "error",
      }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("fails closed without native bindings rather than recursively proxying", async () => {
    delete mocks.env.GEN2_ARM_WORKSPACE_LIFECYCLE;
    await expect(dispatchArmWorkflow(request("POST"))).rejects.toMatchObject({
      status: 503,
    });
  });
});
