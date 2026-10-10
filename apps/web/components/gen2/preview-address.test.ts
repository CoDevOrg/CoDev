import { describe, expect, it } from "vitest";

import { formatPreviewAddress, parsePreviewAddress } from "./preview-address";

describe("preview addresses", () => {
  it.each([
    ["3000", { port: 3000, path: "/" }],
    [" :5173 ", { port: 5173, path: "/" }],
    ["3000/docs", { port: 3000, path: "/docs" }],
    ["localhost:3000/x", { port: 3000, path: "/x" }],
    ["127.0.0.1:8080/a?b=1#c", { port: 8080, path: "/a?b=1#c" }],
    ["http://localhost:4321/blog/", { port: 4321, path: "/blog/" }],
    ["https://[::1]:3000", { port: 3000, path: "/" }],
    ["localhost:80", { port: 80, path: "/" }],
    ["localhost:3000/a/../b", { port: 3000, path: "/b" }],
    ["/settings?tab=2", { port: null, path: "/settings?tab=2" }],
  ])("reads %j", (input, expected) => {
    expect(parsePreviewAddress(input)).toEqual(expected);
  });

  it.each([
    "",
    "0",
    "70000",
    "localhost",
    "example.com:3000",
    "http://evil.example:3000/",
    "localhost:3000@evil.example",
    "user@localhost:3000",
    "//evil.example",
    "/\\evil.example",
    "localhost:3000/a b",
    "javascript:alert(1)",
  ])("refuses %j", (input) => {
    expect(parsePreviewAddress(input)).toBeNull();
  });

  it("shows what was opened", () => {
    expect(formatPreviewAddress(3000, "/")).toBe("localhost:3000");
    expect(formatPreviewAddress(3000, "/x?y")).toBe("localhost:3000/x?y");
  });
});
