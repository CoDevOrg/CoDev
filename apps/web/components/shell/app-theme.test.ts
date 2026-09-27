import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Several assertions below match multi-line selector lists, so they depend on
 * the line endings on disk. Git checks these files out with CRLF wherever
 * `core.autocrlf` is on (every default Windows clone), which failed three of
 * these tests locally while CI stayed green — an environment difference, not a
 * theme regression. Normalize on read so the assertions test the CSS.
 */
function readCss(name: string): string {
  return readFileSync(resolve(process.cwd(), "app", name), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const appTheme = readCss("app-theme.css");
const globals = readCss("globals.css");
const landing = readCss("landing.css");

describe("CoDev product theme", () => {
  it("sets one cream/navy palette for every AppChrome product page", () => {
    expect(appTheme).toContain(".app-page,\n.auth-page {");
    expect(appTheme).toContain("--surface: var(--codev-black-950);");
    expect(appTheme).toContain("--ink: var(--codev-beige-100);");
    expect(appTheme).toContain("--codev-gold-500: #1b63b3;");
    expect(appTheme).toContain("--codev-black-950: #f2e9d6;");
    expect(appTheme).toContain("--codev-beige-100: #0e2f7e;");
    expect(appTheme).toContain("color-scheme: light;");
    expect(appTheme).toContain("--orange: var(--codev-terracotta);");
  });

  it("uses the same light surfaces for the dashboard workspace browser", () => {
    expect(appTheme).toContain(".workspace-browser {");
    expect(appTheme).toContain("background: rgba(255, 253, 247, 0.72);");
    expect(appTheme).toContain(".workspace-card:hover {");
  });

  it("keeps every profile menu action legible on the light product surface", () => {
    expect(appTheme).toContain(
      ".app-page .profile-menu-link,\n.app-page .profile-menu-action {",
    );
    expect(appTheme).toContain("color: var(--muted);");
  });

  it("extends the product theme to unauthenticated pages", () => {
    expect(appTheme).toContain(".auth-page {");
    expect(appTheme).toContain(".auth-page .auth-card {");
    expect(appTheme).toContain(".auth-page .auth-submit {");
  });

  it("keeps auth password guidance readable on the light card", () => {
    expect(appTheme).toContain(
      ".auth-page .auth-password-guidance,\n.auth-page .auth-password-guidance p,\n.auth-page .auth-password-guidance .unmet {",
    );
    expect(appTheme).toContain("color: var(--codev-beige-200);");
    expect(appTheme).toContain(".auth-page .auth-password-guidance .met {");
    expect(appTheme).toContain("color: var(--codev-beige-100);");
    expect(appTheme).toContain(
      ".auth-page .auth-password-guidance .met > span {",
    );
    expect(appTheme).toContain("color: var(--codev-gold-400);");
  });

  it("keeps the public landing page in its own stylesheet", () => {
    // The marketing surface is deliberately not part of the product theme.
    // Every rule is scoped under `.lp-page` in app/landing.css so it can never
    // bleed into an authenticated page.
    expect(globals).not.toContain(".landing-page {");
    expect(landing).toContain(".lp-page {");
    expect(landing).toContain("--lp-bg: #f2e9d6;");
    expect(landing).toContain(".lp-hero h1 em {");
    expect(landing).toContain("var(--lp-lime)");
    expect(landing).toContain("var(--lp-sky)");
    expect(landing).toContain("var(--lp-orange)");
    expect(landing).toContain("animation: lp-sheen 6s linear infinite;");
    expect(landing).not.toContain("10, 36, 25");
    expect(landing).not.toContain("4, 18, 14");
    for (const rule of landing.split("\n")) {
      if (!rule.endsWith("{") || rule.startsWith(" ") || rule.startsWith("@")) {
        continue;
      }
      expect(rule).toMatch(/\.lp-|^@keyframes|^:/);
    }
  });

  it("shares the cream/navy palette between landing and product", () => {
    // Landing invented the paper cream + deep navy + blue accent palette;
    // the product shell now uses the same tokens so the signed-in app
    // matches the marketing surface. The IDE workspace stays dark.
    expect(landing).toContain("--lp-bg: #f2e9d6;");
    expect(landing).toContain("--lp-ink: #0e2f7e;");
    expect(landing).toContain("color-scheme: light;");
    expect(globals).toContain("color-scheme: light");
    expect(globals).toContain("--surface: #f2e9d6;");
    expect(globals).toContain("--ink: #0e2f7e;");
    expect(globals).toContain("--gold: #1b63b3;");

    // The workspace IDE page keeps a dark document for coding chrome.
    expect(globals).toContain(".workspace-page {");
    expect(globals).toContain("--workspace-surface: #121417;");
    expect(globals).toMatch(/\.workspace-page \{[^}]*color-scheme: dark;/s);

    // The workspace demo stays a dark panel on the light landing page, so it
    // re-declares the ink tokens rather than inheriting the navy ones.
    const demo = landing.slice(landing.indexOf(".lp-demo {"));
    expect(demo).toContain("--lp-ink: #edeef0;");
    expect(demo).toContain("background: #121417;");
  });

  it("keeps a readable backdrop for readers who never get the canvas", () => {
    // The WebGL layer is progressive enhancement. The still is server-rendered
    // in app/page.tsx and only steps aside once the canvas reports that it is
    // drawing, so reduced motion, a browser without WebGL, and no JavaScript
    // at all each keep a complete backdrop.
    const page = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    expect(page).toContain('<div className="lp-canvas-still" />');

    expect(landing).toContain(".lp-canvas-still {");
    expect(landing).toContain("/brand/landing/hero-still.webp");
    expect(landing).toContain(
      '.lp-page:has(.lp-canvas-layer[data-canvas="on"]) .lp-canvas-still {',
    );

    // The canvas never takes pointer events away from the content above it.
    expect(landing).toContain(".lp-canvas-layer {");
    expect(landing).toMatch(/\.lp-canvas-layer \{[^}]*pointer-events: none;/);
  });

  it("carries ambient motion through each CoDev page shell", () => {
    expect(appTheme).toContain("@keyframes codev-page-ambient {");
    expect(landing).toContain("animation: codev-page-ambient 26s");
    expect(appTheme).toContain("@media (prefers-reduced-motion: reduce) {");
  });

  it("moves landing atmosphere with compositor transforms instead of full-page paints", () => {
    expect(appTheme).toContain("transform: translate3d(40px, -32px, 0);");
    expect(appTheme).not.toContain("background-position: 48% 22%");
    expect(appTheme).not.toContain("background-size: 135% 135%");
    expect(appTheme).not.toContain("mix-blend-mode: screen");
    expect(landing).toContain("position: fixed");
    expect(landing).not.toContain("feTurbulence");
    expect(landing).not.toContain("mix-blend-mode: multiply");
  });

  it("stops every landing animation for readers who ask for reduced motion", () => {
    expect(landing).toContain("@media (prefers-reduced-motion: reduce) {");
    expect(landing).toContain("animation-iteration-count: 1 !important;");
  });

  it("keeps landing copy free of arrows, checkmarks, and em dashes", () => {
    const landingCopy = [
      readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8"),
      readFileSync(
        resolve(process.cwd(), "components/landing/request-access-form.tsx"),
        "utf8",
      ),
      readFileSync(
        resolve(process.cwd(), "components/landing/landing-workspace-demo.tsx"),
        "utf8",
      ),
    ].join("\n");

    expect(landingCopy).not.toContain("↗");
    expect(landingCopy).not.toContain("→");
    expect(landingCopy).not.toContain("✓");
    expect(landingCopy).not.toContain("—");
  });
});
