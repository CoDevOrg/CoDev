import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { isBreachedPassword } from "./breached-password";

const suffix = (password: string) =>
  createHash("sha1").update(password).digest("hex").toUpperCase().slice(5);

describe("isBreachedPassword", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only the hash prefix and matches a listed suffix", async () => {
    const fetch = vi.fn(
      async () => new Response(`${suffix("hunter2")}:42\r\nABCDEF:0\r\n`),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await isBreachedPassword("hunter2")).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain(suffix("hunter2"));
    expect(new Headers(init.headers).get("Add-Padding")).toBe("true");
  });

  it("ignores padding rows and fails open on outages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`${suffix("unique pass")}:0\n`)),
    );
    expect(await isBreachedPassword("unique pass")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await isBreachedPassword("anything")).toBe(false);
  });
});
