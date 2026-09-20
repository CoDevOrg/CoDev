import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({
  ORCHESTRATOR_DIRECT_URL: "https://host.example.test",
  ORCHESTRATOR_DIRECT_SECRET: "0123456789abcdef0123456789abcdef",
}));
const runtimeHostPool = vi.hoisted(() => ({
  resolveRuntimeHostForWorkspace: vi.fn().mockResolvedValue(null),
}));

vi.mock("@codev/config", () => ({
  readServerEnvironment: () => environment,
}));

vi.mock("./host", () => ({
  requestHostWake: vi.fn(),
}));
vi.mock("./runtime-host-pool", () => runtimeHostPool);

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { checkOrchestratorConnection } from "./orchestrator";
import { orchestratorRequest } from "./orchestrator-request";

const healthy = () =>
  new Response(
    JSON.stringify({ status: "ok", service: "codev-orchestrator" }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

describe("orchestrator transport", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(healthy());
    runtimeHostPool.resolveRuntimeHostForWorkspace.mockResolvedValue(null);
  });

  /**
   * There is one transport now. apps/web used to carry a second — SigV4-signed
   * requests to the API Gateway + Lambda proxy that fronted the EC2 host — and
   * chose between them on CLOUD_PROVIDER. That proxy's hard 29-second timeout
   * could not carry a 900-second Codex turn, which is why the bearer path was
   * built to bypass it; with AWS retired the bypass is simply the path. The
   * health check is the smallest call that exercises the shared request
   * function.
   */
  it("sends every call down the bearer-authenticated host path", async () => {
    await checkOrchestratorConnection();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://host.example.test/healthz");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      "Bearer 0123456789abcdef0123456789abcdef",
    );
    // Nothing should be reaching for an AWS signature any more.
    expect(headers.authorization).not.toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("fails loudly when the host path is not configured", async () => {
    environment.ORCHESTRATOR_DIRECT_URL = "";
    await expect(checkOrchestratorConnection()).rejects.toThrow(
      /ORCHESTRATOR_DIRECT_URL/,
    );
    environment.ORCHESTRATOR_DIRECT_URL = "https://host.example.test";
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes workspace requests to their fenced runtime host", async () => {
    runtimeHostPool.resolveRuntimeHostForWorkspace.mockResolvedValueOnce({
      runtimeAddress: "https://runtime-2.example.test",
    });

    await orchestratorRequest(
      "GET",
      "/v1/sandboxes/11111111-1111-4111-8111-111111111111/ide",
    );

    expect(runtimeHostPool.resolveRuntimeHostForWorkspace).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://runtime-2.example.test/v1/sandboxes/11111111-1111-4111-8111-111111111111/ide",
    );
  });

  it("routes sandbox creation from its workspace id in the body", async () => {
    runtimeHostPool.resolveRuntimeHostForWorkspace.mockResolvedValueOnce({
      runtimeAddress: "https://runtime-3.example.test",
    });
    const body = { workspaceId: "22222222-2222-4222-8222-222222222222" };

    await orchestratorRequest("POST", "/v1/sandboxes", body);

    expect(runtimeHostPool.resolveRuntimeHostForWorkspace).toHaveBeenCalledWith(
      body.workspaceId,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://runtime-3.example.test/v1/sandboxes",
    );
  });
});
