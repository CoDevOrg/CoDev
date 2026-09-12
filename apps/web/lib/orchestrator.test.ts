import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({
  CLOUD_PROVIDER: undefined as "aws" | "azure" | undefined,
  ORCHESTRATOR_URL: "https://gateway.example.test",
  ORCHESTRATOR_DIRECT_URL: "https://host.example.test",
  ORCHESTRATOR_DIRECT_SECRET: "0123456789abcdef0123456789abcdef",
}));

vi.mock("@codev/config", () => ({
  readServerEnvironment: () => environment,
}));

vi.mock("./aws", () => ({
  getAwsConfiguration: () => ({
    region: "us-east-2",
    credentials: {
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
    },
  }),
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
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("orchestrator transport selection", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(healthy());
    environment.CLOUD_PROVIDER = undefined;
  });

  it("signs ordinary calls for the API Gateway on AWS", async () => {
    await checkOrchestratorConnection();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://gateway.example.test/healthz");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("sends every call down the bearer-authenticated direct path on Azure", async () => {
    // Not only the long-running exec calls: on Azure there is no API Gateway
    // to sign for, so a signed request would be sent to an endpoint that
    // does not exist for that cloud. The health check is the smallest call
    // that exercises the shared request function.
    environment.CLOUD_PROVIDER = "azure";
    await checkOrchestratorConnection();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://host.example.test/healthz");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      "Bearer 0123456789abcdef0123456789abcdef",
    );
  });

  it("fails loudly on Azure when the direct path is not configured", async () => {
    environment.CLOUD_PROVIDER = "azure";
    environment.ORCHESTRATOR_DIRECT_URL = "";
    await expect(checkOrchestratorConnection()).rejects.toThrow(
      /ORCHESTRATOR_DIRECT_URL/,
    );
    environment.ORCHESTRATOR_DIRECT_URL = "https://host.example.test";
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
