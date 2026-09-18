import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL(".", import.meta.url)),
  "server-only": fileURLToPath(
    new URL("./test-support/server-only.ts", import.meta.url),
  ),
};

/**
 * next-auth's ESM build imports `next/server` without an extension, which
 * Node's own resolver rejects ("Did you mean next/server.js?"). Left
 * external, any node-environment test whose imports reach `lib/auth/identity`
 * fails to load; inlining it lets Vite resolve the import instead.
 */
const server = { deps: { inline: ["next-auth"] } };

/**
 * Two projects, because a DOM is expensive and most of these tests do not want
 * one. `lib` is pure logic — not one of its files touches `document`, `window`
 * or Testing Library — but a single global `environment: "jsdom"` was booting a
 * full DOM for every one of them, and the jest-dom/Testing Library setup file
 * on top of that. On this suite the DOM alone accounted for more wall time than
 * the assertions did by an order of magnitude.
 *
 * A test under `lib` that genuinely needs a DOM should say so in its own
 * docblock (`// @vitest-environment jsdom`) rather than moving the default back.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "lib",
          environment: "node",
          server,
          include: ["lib/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "app",
          environment: "node",
          server,
          include: ["app/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["components/**/*.test.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
