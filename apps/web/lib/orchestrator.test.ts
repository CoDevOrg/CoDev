import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({
  ORCHESTRATOR_DIRECT_URL: "https://host.example.test",
  ORCHESTRATOR_DIRECT_SECRET: "0123456789abcdef0123456789abcdef",
}));

vi.mock("@codev/config", () => ({
  readServerEnvironment: () => environment,
}));

vi.mock("./host", () => ({
  requestHostWake: vi.fn(),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { checkOrchestratorConnection } from "./orchestrator";

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
});
