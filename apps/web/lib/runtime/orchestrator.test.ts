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

import {
  checkOrchestratorConnection,
  restoreSandboxSession,
} from "./orchestrator";

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

  it("uploads session repository state in bounded chunks before finalizing", async () => {
    const contents = new Uint8Array(512 * 1_024 + 7).fill(42);
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/finalize")) {
        return Response.json({ status: "restored", conflictPaths: [] });
      }
      if (url.endsWith("/chunks")) {
        const body = JSON.parse(String(init.body));
        return Response.json({
          nextOffset:
            body.offset + Buffer.from(body.contentBase64, "base64").byteLength,
        });
      }
      return Response.json({ accepted: true }, { status: 202 });
    });

    await expect(
      restoreSandboxSession({
        workspaceId: "workspace-1",
        operationId: "import-1",
        worktreeId: "worktree-1",
        baseCommitSha: "a".repeat(40),
        files: [
          {
            path: "notes/context.bin",
            kind: "untracked",
            contents,
            sha256: "b".repeat(64),
            mode: "100644",
          },
        ],
      }),
    ).resolves.toEqual({ status: "restored", conflictPaths: [] });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const begin = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(begin.files[0]).toEqual({
      path: "notes/context.bin",
      kind: "untracked",
      bytes: contents.byteLength,
      sha256: "b".repeat(64),
      mode: "100644",
    });
    const firstChunk = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const secondChunk = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(firstChunk.offset).toBe(0);
    expect(Buffer.from(firstChunk.contentBase64, "base64")).toHaveLength(
      512 * 1_024,
    );
    expect(secondChunk.offset).toBe(512 * 1_024);
    expect(Buffer.from(secondChunk.contentBase64, "base64")).toHaveLength(7);
  });
});
