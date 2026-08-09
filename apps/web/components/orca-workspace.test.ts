import { describe, expect, it } from "vitest";

import { applyOrcaWorkspaceBranding } from "./orca-workspace";

describe("applyOrcaWorkspaceBranding", () => {
  it("replaces the empty-state mark and labels the IDE with its workspace", () => {
    const doc = document.implementation.createHTMLDocument("Orca");
    doc.body.innerHTML = `
      <img alt="CoDev logo" src="/orca/assets/orca-logo.png" />
      <span class="titlebar-app-name-main">CoDev</span>
    `;

    applyOrcaWorkspaceBranding(doc, "yousef20920/CoDev");

    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/codev-mark-v3.png",
    );
    expect(doc.querySelector("img")?.className).toContain(
      "codev-orca-empty-logo",
    );
    expect(
      doc
        .querySelector(".titlebar-app-name-main")
        ?.getAttribute("data-codev-workspace-name"),
    ).toBe("yousef20920/CoDev");
  });
});
