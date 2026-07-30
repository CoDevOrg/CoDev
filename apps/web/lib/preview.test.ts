import { describe, expect, it } from "vitest";

import {
  assertPreviewPath,
  buildStaticPreviewSource,
  contentTypeForPreviewPath,
  ensureHtmlBaseHref,
  iframeSrcForPreviewSource,
  isPreviewExtensionAllowed,
  normalizePreviewPath,
  resolvePreviewEntry,
} from "./preview";

describe("resolvePreviewEntry", () => {
  it("prefers index.html, then public/, then docs/, then first root html", () => {
    expect(resolvePreviewEntry(["src/app.html", "readme.md"])).toBeNull();
    expect(resolvePreviewEntry(["docs/index.html", "public/index.html"])).toBe(
      "public/index.html",
    );
    expect(resolvePreviewEntry(["docs/index.html", "about.html"])).toBe(
      "docs/index.html",
    );
    expect(resolvePreviewEntry(["index.html", "public/index.html"])).toBe(
      "index.html",
    );
    expect(resolvePreviewEntry(["zeta.html", "alpha.html", "nested/x.html"])).toBe(
      "alpha.html",
    );
  });
});

describe("preview path allowlist", () => {
  it("accepts allowlisted relative assets and rejects dangerous paths", () => {
    expect(normalizePreviewPath("css/app.css")).toBe("css/app.css");
    expect(normalizePreviewPath("./index.html")).toBe("index.html");
    expect(isPreviewExtensionAllowed("assets/logo.png")).toBe(true);
    expect(isPreviewExtensionAllowed(".env")).toBe(false);
    expect(normalizePreviewPath("../secret")).toBeNull();
    expect(normalizePreviewPath("/etc/passwd")).toBeNull();
    expect(normalizePreviewPath("node_modules/pkg/index.js")).toBeNull();
    expect(normalizePreviewPath(".git/config")).toBeNull();
    expect(() => assertPreviewPath("src/main.ts")).toThrow(
      /extension is not allowed/i,
    );
    expect(() => assertPreviewPath("..\\win.ini")).toThrow(/not allowed/i);
    expect(contentTypeForPreviewPath("app.js")).toContain("javascript");
    expect(contentTypeForPreviewPath("index.html")).toContain("text/html");
  });
});

describe("PreviewSource helpers", () => {
  it("builds static sources and leaves live mode for later port forwarding", () => {
    const source = buildStaticPreviewSource(
      ["public/index.html", "public/app.css"],
      "rev-1",
    );
    expect(source).toEqual({
      kind: "static",
      entryPath: "public/index.html",
      cacheKey: "rev-1",
    });
    expect(iframeSrcForPreviewSource("ws_1", source!)).toBe(
      "/api/workspaces/ws_1/preview/public/index.html?v=rev-1",
    );

    const live = { kind: "live" as const, proxyUrl: "https://example.test/p" };
    expect(iframeSrcForPreviewSource("ws_1", live)).toBe(
      "https://example.test/p",
    );
  });

  it("injects a base href when HTML is missing one", () => {
    expect(
      ensureHtmlBaseHref("<html><head></head><body></body></html>", "/p/"),
    ).toContain('<base href="/p/">');
    expect(
      ensureHtmlBaseHref('<html><head><base href="/x/"></head></html>', "/p/"),
    ).toContain('<base href="/x/">');
  });
});
