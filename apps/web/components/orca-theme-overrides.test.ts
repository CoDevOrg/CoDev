import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const themeOverrides = readFileSync(
  resolve(process.cwd(), "public/orca-theme-overrides.css"),
  "utf8",
);

describe("Orca theme overrides", () => {
  it("replaces Orca's active dark-mode design tokens with CoDev tokens", () => {
    expect(themeOverrides).toContain("html.dark {");
    expect(themeOverrides).toContain(
      "--background: var(--codev-workspace-surface);",
    );
    expect(themeOverrides).toContain("--primary: var(--codev-accent);");
    expect(themeOverrides).toContain(
      "--sidebar: var(--codev-workspace-surface-2);",
    );
    expect(themeOverrides).toContain("--sidebar-primary: var(--codev-accent);");
  });

  it("hides Orca's self-promotional GitHub star-nag surfaces", () => {
    expect(themeOverrides).toContain(
      '[role="complementary"][aria-labelledby="star-nag-heading"] {',
    );
    expect(themeOverrides).toContain('[class*="border-amber-500/60"]');
    expect(themeOverrides).toContain('[class*="border-amber-500/50"]');
  });

  it("uses the CoDev orange mark in Orca's empty workspace state", () => {
    expect(themeOverrides).toContain(".codev-orca-empty-logo {");
    expect(themeOverrides).toContain("hue-rotate(340deg)");
  });
});
