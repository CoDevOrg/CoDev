import { describe, expect, it } from "vitest";
import { prepareNodeRequest } from "./node-origin.mjs";

const secret = "a".repeat(64);
function request(
  url: string,
  remoteAddress = "192.0.2.1",
  credential = secret,
) {
  return {
    url,
    socket: { remoteAddress },
    headers: {
      "x-codev-origin-secret": credential,
      "x-codev-public-host": "www.trycodev.com",
    } as Record<string, string>,
  };
}

describe("Node origin authorization", () => {
  it("authenticates public app requests", () => {
    expect(prepareNodeRequest(request("/gen2"), secret)).toBe(true);
    expect(
      prepareNodeRequest(request("/gen2", undefined, "forged"), secret),
    ).toBe(false);
  });
  it("rejects external queue calls even with the trusted edge credential", () => {
    for (const url of [
      "/.well-known/workflow/v1/flow",
      "/.well-known/workflow/v1/step",
      "/%2ewell-known/workflow/v1/step",
    ]) {
      expect(prepareNodeRequest(request(url), secret)).toBe(false);
    }
  });
  it("allows only genuine loopback queue dispatch without the edge credential", () => {
    const local = request("/.well-known/workflow/v1/step", "127.0.0.1", "");
    expect(prepareNodeRequest(local, secret)).toBe(true);
    expect(local.headers.host).toBe("www.trycodev.com");
  });
});
