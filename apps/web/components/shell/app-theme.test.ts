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
const themeTokens = readCss("theme-tokens.css");
const productTheme = readCss("product-theme.css");
const settingsTheme = readCss("settings/settings-theme.css");

describe("CoDev product theme", () => {
  it("keeps every actual color literal in one file: theme-tokens.css", () => {
    // app-theme.css, product-theme.css and settings/settings-theme.css each used
    // to hold their own copy of this palette under their own token names,
    // which is exactly what let Rooms stay light after everything else went
    // dark. Now only this file has a real hex/rgba value; everything else is
    // a var() reference into it, checked in the tests below.
    expect(themeTokens).toContain("--brand-paper: #f2e9d6;");
    expect(themeTokens).toContain("--brand-ink: #0e2f7e;");
    expect(themeTokens).toContain("--brand-accent: #1b63b3;");
    expect(themeTokens).toContain("@media (prefers-color-scheme: dark) {");
    expect(themeTokens).toContain('[data-theme="dark"] {');
    expect(themeTokens).toContain("--brand-paper: #070c1a;");
    expect(themeTokens).toContain("--brand-ink: #f2e9d6;");
    expect(themeTokens).toContain("--brand-accent: #3d8fe0;");
  });

  it("sets one cream/navy palette for every AppChrome product page", () => {
    expect(appTheme).toContain(".app-page,\n.auth-page {");
    expect(appTheme).toContain("--surface: var(--codev-black-950);");
    expect(appTheme).toContain("--ink: var(--codev-beige-100);");
    expect(appTheme).toContain("--codev-gold-500: var(--brand-accent);");
    expect(appTheme).toContain("--codev-black-950: var(--brand-paper);");
    expect(appTheme).toContain("--codev-beige-100: var(--brand-ink);");
    expect(appTheme).toContain(
      "color-scheme: var(--brand-color-scheme, light);",
    );
    expect(appTheme).toContain("--orange: var(--codev-terracotta);");
    // No hex/rgba literal for this palette should remain in app-theme.css --
    // everything routes through theme-tokens.css's --brand-* swatches now.
    expect(appTheme).not.toContain("#f2e9d6");
    expect(appTheme).not.toContain("#0e2f7e");
    expect(appTheme).not.toContain("#1b63b3");
  });

  it("uses the same light surfaces for the dashboard workspace browser", () => {
    expect(appTheme).toContain(".workspace-browser {");
    // The glass-panel translucency is a --paper-rgb reference (itself an
    // alias onto theme-tokens.css's --brand-paper-rgb) rather than a bare
    // literal, so it flips with the theme instead of staying stuck light
    // everywhere else .workspace-browser is used.
    expect(appTheme).toContain("background: rgba(var(--paper-rgb), 0.72);");
    expect(appTheme).toContain(".workspace-card:hover {");
  });

  it("ships a shared shadcn product theme for Rooms and the dashboard", () => {
    expect(productTheme).toContain(".product-scope,");
    expect(productTheme).toContain(".rooms-scope {");
    expect(productTheme).toContain("--color-background: var(--brand-paper);");
    expect(productTheme).toContain("--color-primary: var(--brand-accent);");
    // Glass panels over the animated gradient backdrop, unlike Settings'
    // opaque cards -- a real design difference, kept as its own alpha wash
    // rather than forced to match settings/settings-theme.css.
    expect(productTheme).toContain(
      "--color-card: rgba(var(--brand-paper-rgb), 0.62);",
    );
    // No separate dark-mode block needed: every value above already flips
    // because theme-tokens.css's swatches do.
    expect(productTheme).not.toContain("@media (prefers-color-scheme: dark)");
    expect(productTheme).not.toContain("#070c1a");
  });

  it("gives Settings the same shared theme, with its own opaque surfaces", () => {
    expect(settingsTheme).toContain(".settings-scope {");
    expect(settingsTheme).toContain("--color-background: var(--brand-paper);");
    expect(settingsTheme).toContain("--color-primary: var(--brand-accent);");
    // Solid surfaces, not glass -- Settings has no gradient backdrop behind
    // it for a translucent card to let show through.
    expect(settingsTheme).toContain("--color-card: var(--brand-paper-bright);");
    expect(settingsTheme).not.toContain("@media (prefers-color-scheme: dark)");
    expect(settingsTheme).not.toContain("#070c1a");
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
