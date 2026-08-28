import { describe, expect, it } from "vitest";

import { hideOrcaProjectTree, watchOrcaProjectTree } from "./orca-project-tree";

function sidebarDocument({ withProject = true } = {}) {
  const doc = document.implementation.createHTMLDocument("orca");
  doc.body.innerHTML = `
    <div class="sidebar">
      <div class="sidebar-header">Tasks</div>
      <button aria-label="Search">Search</button>
      <div class="sidebar-header">Projects</div>
      <button aria-label="Add Project">+</button>
      ${withProject ? '<div class="worktree-list"><div class="worktree-item">main</div></div>' : ""}
    </div>
    <div class="editor-area">
      <div class="sidebar-header">Projects</div>
    </div>
  `;
  return doc;
}

function displayOf(doc: Document, selector: string) {
  return doc.querySelector<HTMLElement>(selector)?.style.display ?? null;
}

describe("hideOrcaProjectTree", () => {
  it("hides the project tree and its section label", () => {
    const doc = sidebarDocument();

    expect(hideOrcaProjectTree(doc)).toBeGreaterThan(0);

    expect(displayOf(doc, ".worktree-list")).toBe("none");
    const headers = [...doc.querySelectorAll<HTMLElement>(".sidebar-header")];
    const projectHeaders = headers.filter(
      (header) => header.textContent?.trim() === "Projects",
    );
    expect(projectHeaders).toHaveLength(2);
    expect(
      projectHeaders.every((header) => header.style.display === "none"),
    ).toBe(true);
  });

  it("leaves the rest of the sidebar alone", () => {
    const doc = sidebarDocument();
    hideOrcaProjectTree(doc);

    const tasks = [
      ...doc.querySelectorAll<HTMLElement>(".sidebar-header"),
    ].find((header) => header.textContent?.trim() === "Tasks");
    expect(tasks?.style.display).toBe("");
    expect(displayOf(doc, '[aria-label="Search"]')).toBe("");
  });

  it("hides Add Project only once a project is open", () => {
    const empty = sidebarDocument({ withProject: false });
    hideOrcaProjectTree(empty);
    expect(displayOf(empty, '[aria-label="Add Project"]')).toBe("");

    const opened = sidebarDocument();
    hideOrcaProjectTree(opened);
    expect(displayOf(opened, '[aria-label="Add Project"]')).toBe("none");
  });

  it("counts nothing on a second pass over the same document", () => {
    const doc = sidebarDocument();
    expect(hideOrcaProjectTree(doc)).toBeGreaterThan(0);
    expect(hideOrcaProjectTree(doc)).toBe(0);
  });

  it("does nothing to a document that has not rendered a sidebar", () => {
    const doc = document.implementation.createHTMLDocument("orca");
    expect(hideOrcaProjectTree(doc)).toBe(0);
  });
});

describe("watchOrcaProjectTree", () => {
  it("hides a tree that Orca re-renders later", async () => {
    const doc = sidebarDocument({ withProject: false });
    const stop = watchOrcaProjectTree(doc);

    const list = doc.createElement("div");
    list.className = "worktree-list";
    doc.querySelector(".sidebar")!.append(list);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list.style.display).toBe("none");

    stop();
    const second = doc.createElement("div");
    second.className = "worktree-list";
    doc.querySelector(".sidebar")!.append(second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.style.display).toBe("");
  });
});
