import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appTheme = readFileSync(
  resolve(process.cwd(), "app/app-theme.css"),
  "utf8",
);

describe("CoDev product theme", () => {
  it("sets one dark palette for every AppChrome product page", () => {
    expect(appTheme).toContain(".app-page,\n.auth-page {");
    expect(appTheme).toContain("--surface: var(--codev-forest-950);");
    expect(appTheme).toContain("--ink: var(--codev-beige-100);");
    expect(appTheme).toContain("--orange: var(--codev-orange-500);");
  });

  it("uses the same dark surfaces for the dashboard workspace browser", () => {
    expect(appTheme).toContain(".workspace-browser {");
    expect(appTheme).toContain("background: rgba(20, 44, 34, 0.7);");
    expect(appTheme).toContain(".workspace-card:hover {");
  });

  it("extends the product theme to unauthenticated pages", () => {
    expect(appTheme).toContain(".auth-page {");
    expect(appTheme).toContain(".auth-page .auth-card {");
    expect(appTheme).toContain(".auth-page .auth-submit {");
  });

  it("gives public landing pages the same palette and full-width layout", () => {
    expect(appTheme).toContain(".landing-page {");
    expect(appTheme).toContain("--landing-paper: var(--codev-forest-950);");
    expect(appTheme).toContain(".landing-nav,\n.landing-hero,");
    expect(appTheme).toContain("width: 100%;");
  });
});
