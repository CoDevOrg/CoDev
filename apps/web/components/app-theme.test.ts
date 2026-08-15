import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appTheme = readFileSync(
  resolve(process.cwd(), "app/app-theme.css"),
  "utf8",
);
const globals = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

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

  it("gives public landing pages the same palette and full-width layout", () => {
    expect(appTheme).toContain(".landing-page {");
    expect(appTheme).toContain("--landing-paper: var(--codev-forest-950);");
    expect(appTheme).toContain(".landing-nav,\n.landing-hero,");
    expect(appTheme).toContain("width: 100%;");
  });

  it("carries ambient motion through each CoDev page shell", () => {
    expect(appTheme).toContain("@keyframes codev-page-ambient {");
    expect(appTheme).toContain("animation: codev-page-ambient 26s");
    expect(appTheme).toContain("@media (prefers-reduced-motion: reduce) {");
  });

  it("moves landing atmosphere with compositor transforms instead of full-page paints", () => {
    expect(appTheme).toContain("transform: translate3d(40px, -32px, 0);");
    expect(appTheme).not.toContain("background-position: 48% 22%");
    expect(appTheme).not.toContain("background-size: 135% 135%");
    expect(appTheme).not.toContain("mix-blend-mode: screen");
    expect(globals).toContain(".landing-ambient");
    expect(globals).toContain("position: fixed");
    expect(globals).not.toContain("feTurbulence");
    expect(globals).not.toContain("landing-paper-lines");
    expect(globals).not.toContain("mix-blend-mode: multiply");
  });
});
