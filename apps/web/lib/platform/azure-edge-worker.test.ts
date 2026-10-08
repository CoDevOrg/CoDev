import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./azure-edge-worker";

const env = {
  AZURE_WEB_ORIGIN: "https://origin.example.test",
  AZURE_WEB_ORIGIN_SECRET: "origin-secret",
  CRON_SECRET: "cron-secret",
};
afterEach(() => vi.unstubAllGlobals());

describe("Azure edge proxy", () => {
  it("preserves paths, query, cookies and redirects, replacing untrusted routing headers", async () => {
    const redirected = new Response(null, {
      status: 307,
      headers: { location: "/sign-in" },
    });
    const fetchMock = vi.fn().mockResolvedValue(redirected);
    vi.stubGlobal("fetch", fetchMock);
    const result = await worker.fetch(
      new Request("https://www.trycodev.com/gen2?tab=files", {
        headers: {
          host: "www.trycodev.com",
          cookie: "session=test",
          "x-codev-public-host": "attacker.test",
          "x-codev-origin-secret": "forged",
          "x-codev-node-websocket-id": "forged",
          "x-forwarded-for": "forged",
          "x-vercel-forwarded-for": "forged-vercel-ip",
          "cf-connecting-ip": "192.0.2.1",
        },
      }),
      env,
    );
    const forwarded = fetchMock.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe("https://origin.example.test/gen2?tab=files");
    expect(forwarded.redirect).toBe("manual");
    expect(forwarded.headers.get("cookie")).toBe("session=test");
    expect(forwarded.headers.get("host")).toBeNull();
    expect(forwarded.headers.get("x-codev-public-host")).toBe(
      "www.trycodev.com",
    );
    expect(forwarded.headers.get("x-codev-origin-secret")).toBe(
      "origin-secret",
    );
    expect(forwarded.headers.get("x-forwarded-for")).toBe("192.0.2.1");
    expect(forwarded.headers.get("x-vercel-forwarded-for")).toBeNull();
    expect(forwarded.headers.get("x-codev-node-websocket-id")).toBeNull();
    expect(result).toBe(redirected);
  });
  it("fails with a controlled response and never retries mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("origin unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await worker.fetch(
      new Request("https://trycodev.com/api/gen2/workspaces", {
        method: "POST",
      }),
      env,
    );
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not forward public requests to internal workflow handlers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const path of [
      "/.well-known/workflow/v1/step",
      "/%2ewell-known/workflow/v1/flow",
    ]) {
      expect(
        (
          await worker.fetch(
            new Request(`https://www.trycodev.com${path}`),
            env,
          )
        ).status,
      ).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses unrecognized public hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await worker.fetch(new Request("https://attacker.test/gen2"), env))
        .status,
    ).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
