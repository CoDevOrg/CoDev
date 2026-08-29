import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const normalizeLines = (contents: string) => contents.replaceAll("\r\n", "\n");
const appTheme = normalizeLines(
  readFileSync(resolve(process.cwd(), "app/app-theme.css"), "utf8"),
);
const globals = normalizeLines(
  readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8"),
);
const landing = normalizeLines(
  readFileSync(resolve(process.cwd(), "app/landing.css"), "utf8"),
);

describe("CoDev product theme", () => {
  it("sets one dark palette for every AppChrome product page", () => {
    expect(appTheme).toContain(".app-page,\n.auth-page {");
    expect(appTheme).toContain("--surface: var(--codev-forest-950);");
    expect(appTheme).toContain("--ink: var(--codev-beige-100);");
    expect(appTheme).toContain("--codev-orange-500: #d9642c;");
    expect(appTheme).toContain("--orange: var(--codev-orange-500);");
  });

  it("uses the same dark surfaces for the dashboard workspace browser", () => {
    expect(appTheme).toContain(".workspace-browser {");
    expect(appTheme).toContain("background: rgba(20, 44, 34, 0.7);");
    expect(appTheme).toContain(".workspace-card:hover {");
  });

  it("keeps every profile menu action legible on the dark product surface", () => {
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

  it("keeps auth password guidance readable on the dark card", () => {
    expect(appTheme).toContain(
      ".auth-page .auth-password-guidance,\n.auth-page .auth-password-guidance p,\n.auth-page .auth-password-guidance .unmet {",
    );
    expect(appTheme).toContain("color: var(--codev-beige-200);");
    expect(appTheme).toContain(".auth-page .auth-password-guidance .met {");
    expect(appTheme).toContain("color: var(--codev-beige-100);");
    expect(appTheme).toContain(
      ".auth-page .auth-password-guidance .met > span {",
    );
    expect(appTheme).toContain("color: var(--codev-orange-400);");
  });

  it("keeps the public landing page in its own stylesheet", () => {
    // The marketing surface is deliberately not part of the product theme.
    // Every rule is scoped under `.lp-page` in app/landing.css so it can never
    // bleed into an authenticated page.
    expect(globals).not.toContain(".landing-page {");
    expect(landing).toContain(".lp-page {");
    expect(landing).toContain("--lp-forest-950: #0d1f17;");
    expect(landing).toContain("--lp-paper: #f2ede0;");
    expect(landing).toContain("--lp-orange: #d9642c;");
    for (const rule of landing.split("\n")) {
      if (!rule.endsWith("{") || rule.startsWith(" ") || rule.startsWith("@")) {
        continue;
      }
      expect(rule).toMatch(/\.lp-|^@keyframes|^:/);
    }
  });

  it("keeps ambient motion in product shells without adding it to the landing hero", () => {
    expect(appTheme).toContain("@keyframes codev-page-ambient {");
    expect(landing).not.toContain("animation: codev-page-ambient");
    expect(appTheme).toContain("@media (prefers-reduced-motion: reduce) {");
  });

  it("uses product artifacts instead of decorative landing effects", () => {
    expect(appTheme).toContain("transform: translate3d(40px, -32px, 0);");
    expect(landing).not.toContain("background-clip: text");
    expect(landing).not.toContain("lp-grid");
    expect(landing).not.toContain("feTurbulence");
  });

  it("stops every landing animation for readers who ask for reduced motion", () => {
    expect(landing).toContain("@media (prefers-reduced-motion: reduce) {");
    expect(landing).toContain("animation-iteration-count: 1 !important;");
  });
});
