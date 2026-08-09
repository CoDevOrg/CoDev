import { afterEach, describe, expect, it } from "vitest";

import {
  applyOrcaWorkspaceBranding,
  autoAddOrcaProject,
} from "./orca-workspace";

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

describe("autoAddOrcaProject", () => {
  const WORKSPACE_PATH =
    "/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa";

  // autoAddOrcaProject reads `doc.defaultView` (Document.prototype.value on a
  // real iframe's contentDocument), which is only non-null for a document
  // that is the *active* document of a browsing context. A detached document
  // from `createHTMLDocument` has no defaultView, so these tests build
  // fixtures directly in the real jsdom `document` instead, and clean up
  // afterwards.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Builds a jsdom document that mimics Orca's real "Add a project" flow
   * (discovered by driving the live vendored client): an empty-state
   * heading, an icon "Add Project" button that opens a dialog with a host
   * picker, a "Browse folder" step with a path input, and a "Select folder"
   * button that only enables after the (simulated) async path validation
   * that the real host performs.
   */
  function findButtonByText(root: ParentNode, pattern: RegExp) {
    return (
      Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => pattern.test(button.textContent ?? ""),
      ) ?? null
    );
  }

  function createOrcaDocument(steps: string[]) {
    const doc = document;
    doc.body.innerHTML = `
      <h1>Add a project to get started.</h1>
      <button aria-label="Add Project">+</button>
    `;

    doc
      .querySelector<HTMLButtonElement>('button[aria-label="Add Project"]')
      ?.addEventListener("click", () => {
        steps.push("open-add-project-dialog");
        doc.body.insertAdjacentHTML(
          "beforeend",
          `
          <div role="dialog">
            <h2>Add a project</h2>
            <button role="combobox">Local Mac</button>
          </div>
          `,
        );
        const hostTrigger = doc.querySelector<HTMLButtonElement>(
          '[role="dialog"] [role="combobox"]',
        );
        hostTrigger?.addEventListener("click", () => {
          steps.push("open-host-picker");
          doc.body.insertAdjacentHTML(
            "beforeend",
            `
            <div role="option">Add remote host</div>
            <div role="option">Local Mac Local - This computer</div>
            <div role="option">CoDev Server Connected - CoDev server</div>
            `,
          );
          doc.querySelectorAll('[role="option"]').forEach((option) => {
            option.addEventListener("click", () => {
              steps.push(`select-host:${option.textContent}`);
              if (hostTrigger) hostTrigger.textContent = option.textContent;
              doc
                .querySelectorAll('[role="option"]')
                .forEach((node) => node.remove());
            });
          });
        });

        const dialog = doc.querySelector<HTMLElement>('[role="dialog"]');
        dialog?.insertAdjacentHTML(
          "beforeend",
          `<button>Browse folder Existing Git repository or folder on this host</button>`,
        );
        findButtonByText(dialog!, /browse folder/i)?.addEventListener(
          "click",
          () => {
            steps.push(`browse-folder:${hostTrigger?.textContent}`);
            dialog!.innerHTML = `
              <h2>Browse host filesystem</h2>
              <input placeholder="Type to filter or enter a path…" />
              <button disabled>Select folder</button>
            `;
            const input = dialog!.querySelector<HTMLInputElement>("input");
            const selectButton = findButtonByText(dialog!, /select folder/i);
            input?.addEventListener("input", () => {
              steps.push(`enter-path:${input.value}`);
              // Real Orca debounces a host filesystem lookup before
              // enabling the button; simulate that with a short async delay.
              setTimeout(() => selectButton?.removeAttribute("disabled"), 50);
            });
            selectButton?.addEventListener("click", () => {
              steps.push("select-folder");
              // Orca shows a confirmation step for a path that resolves to
              // an existing git repository before actually registering it.
              dialog!.innerHTML = `
                <h2>Add Git Project?</h2>
                <button>Add Git Project</button>
              `;
              findButtonByText(
                dialog!,
                /add git project/i,
              )?.addEventListener("click", () => {
                steps.push("add-git-project");
                doc.body.innerHTML = "<span>Project added.</span>";
              });
            });
          },
        );
      });

    return doc;
  }

  it("drives Orca's own Add Project dialog to open the cloned workspace path", async () => {
    const steps: string[] = [];
    const doc = createOrcaDocument(steps);

    const result = await autoAddOrcaProject(doc, WORKSPACE_PATH, {
      timeoutMs: 2_000,
    });

    expect(result).toBe(true);
    expect(doc.body.textContent).toContain("Project added.");
    // Selects the connected runtime host (not the "Local Mac" default)
    // before browsing, and types the exact cloned path.
    expect(steps).toEqual([
      "open-add-project-dialog",
      "open-host-picker",
      "select-host:CoDev Server Connected - CoDev server",
      `browse-folder:CoDev Server Connected - CoDev server`,
      `enter-path:${WORKSPACE_PATH}`,
      "select-folder",
      "add-git-project",
    ]);
  });

  it("does nothing when Orca already has a project open", async () => {
    document.body.innerHTML = `<span class="titlebar-app-name-main">CoDev</span>`;

    const result = await autoAddOrcaProject(document, WORKSPACE_PATH, {
      timeoutMs: 200,
    });

    expect(result).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("aborts gracefully if the Add Project control can't be found", async () => {
    document.body.innerHTML = `<h1>Add a project to get started.</h1>`;

    const result = await autoAddOrcaProject(document, WORKSPACE_PATH, {
      timeoutMs: 200,
    });

    expect(result).toBe(false);
  });
});
