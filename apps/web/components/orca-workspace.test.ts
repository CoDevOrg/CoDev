import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import {
  applyOrcaWorkspaceBranding,
  autoAddOrcaProject,
  buildOrcaIframeSource,
  createOrcaManagedProposal,
  discardOrcaManagedProposal,
  WorkspaceTopBar,
} from "./orca-workspace";

describe("discardOrcaManagedProposal", () => {
  it("maps an Orca worktree to its session and invokes audited discard", async () => {
    const worktreeId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ sessions: [{ id: "session-1", worktreeId }] }),
      )
      .mockResolvedValueOnce(Response.json({ status: "discarded" }));

    await expect(
      discardOrcaManagedProposal("workspace-1", worktreeId, fetcher),
    ).resolves.toEqual({ managed: true, ok: true });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/workspace-1/agents",
      { cache: "no-store" },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace-1/agents/session-1/discard",
      { method: "POST" },
    );
  });

  it("leaves ordinary Orca worktrees on the native delete path", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        sessions: [
          {
            id: "session-1",
            worktreeId: "c1f9fe13-6881-44a6-adbd-96bc5a946afa",
          },
        ],
      }),
    );

    await expect(
      discardOrcaManagedProposal(
        "workspace-1",
        "d2487707-933c-4f18-8a5d-f5cf31b0ad2e",
        fetcher,
      ),
    ).resolves.toEqual({ managed: false });
  });
});

describe("createOrcaManagedProposal", () => {
  it("creates an isolated managed proposal without sending provider credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          sessionId: "session-1",
          worktreeId: "c1f9fe13-6881-44a6-adbd-96bc5a946afa",
        },
        { status: 201 },
      ),
    );

    await expect(
      createOrcaManagedProposal("workspace-1", fetcher),
    ).resolves.toEqual({
      ok: true,
      worktreeId: "c1f9fe13-6881-44a6-adbd-96bc5a946afa",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/workspaces/workspace-1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Managed proposal",
        draft: true,
        attachments: [],
      }),
    });
  });

  it("rejects a create response that omits the managed worktree id", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ sessionId: "session-1" }, { status: 201 }),
      );

    await expect(
      createOrcaManagedProposal("workspace-1", fetcher),
    ).resolves.toEqual({
      ok: false,
      error: "CoDev did not return a managed proposal worktree.",
    });
  });
});

describe("WorkspaceTopBar", () => {
  it("shows the reconciled three-agent worktree capacity", () => {
    render(createElement(WorkspaceTopBar, { repository: "yousef20920/CoDev" }));

    expect(
      screen.getByLabelText("Agent worktree capacity: 3 slots"),
    ).toHaveTextContent("3 agent worktree slots");
  });
});

describe("buildOrcaIframeSource", () => {
  it("keeps the pairing credential and validated project bootstrap in the URL fragment", () => {
    const source = buildOrcaIframeSource({
      webClientPath: "/orca/web-index.html",
      pairingCode: "secret pairing offer",
      workspacePath:
        "/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa",
      projectKind: "git",
      projectName: "yousef20920/CoDev",
    });
    const url = new URL(source, "https://codev.example");

    expect(url.pathname).toBe("/orca/web-index.html");
    expect(url.search).toBe("");
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("pairing")).toBe("secret pairing offer");
    expect(fragment.get("codev")).toBe("1");
    expect(fragment.get("codevProject")).toBe(
      "/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa",
    );
    expect(fragment.get("codevProjectKind")).toBe("git");
    expect(fragment.get("codevProjectName")).toBe("yousef20920/CoDev");
  });
});

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
   * picker, a "Browse folder" step that lands on a breadcrumb + filterable
   * directory-listing file browser, and a "Select folder" button whose
   * `title` always reflects the directory currently being browsed — the
   * path field itself only *filters* that listing, it doesn't jump to an
   * arbitrary absolute path.
   */
  function findButtonByText(root: ParentNode, pattern: RegExp) {
    return (
      Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => pattern.test(button.textContent ?? ""),
      ) ?? null
    );
  }

  const WORKSPACE_PATH_SEGMENTS: string[] =
    WORKSPACE_PATH.split("/").filter(Boolean);

  // A fake filesystem just deep enough to contain WORKSPACE_PATH, keyed by
  // the joined segments navigated so far ("" is the root).
  const FAKE_DIRECTORY_TREE: Record<string, string[]> = {};
  FAKE_DIRECTORY_TREE[""] = [WORKSPACE_PATH_SEGMENTS[0]!, "home"];
  for (let depth = 0; depth < WORKSPACE_PATH_SEGMENTS.length - 1; depth++) {
    FAKE_DIRECTORY_TREE[WORKSPACE_PATH_SEGMENTS.slice(0, depth + 1).join("/")] =
      [WORKSPACE_PATH_SEGMENTS[depth + 1]!];
  }

  function renderFileBrowser(
    doc: Document,
    dialog: HTMLElement,
    currentSegments: string[],
    steps: string[],
  ) {
    const resolvedPath = `/${currentSegments.join("/")}`;
    const entries = FAKE_DIRECTORY_TREE[currentSegments.join("/")] ?? [];
    dialog.innerHTML = `
      <h2>Browse host filesystem</h2>
      <button>/</button>
      <input placeholder="Type to filter or enter a path…" />
      <div>
        ${entries
          .map(
            (name) =>
              `<button><span class="truncate flex-1 min-w-0">${name}</span></button>`,
          )
          .join("")}
      </div>
      <button title="${resolvedPath}">Select folder</button>
    `;

    findButtonByText(dialog, /^\/$/)?.addEventListener("click", () => {
      steps.push("go-to-root");
      renderFileBrowser(doc, dialog, [], steps);
    });

    const filterInput = dialog.querySelector<HTMLInputElement>("input");
    filterInput?.addEventListener("input", () => {
      steps.push(`filter:${filterInput.value}`);
    });

    dialog
      .querySelectorAll<HTMLSpanElement>("span.truncate.flex-1.min-w-0")
      .forEach((span) => {
        span.closest("button")?.addEventListener("click", () => {
          const name = span.textContent ?? "";
          steps.push(`navigate:${name}`);
          renderFileBrowser(doc, dialog, [...currentSegments, name], steps);
        });
      });

    findButtonByText(dialog, /select folder/i)?.addEventListener(
      "click",
      () => {
        steps.push(`select-folder:${resolvedPath}`);
        // Orca shows a confirmation step for a path that resolves to an
        // existing git repository before actually registering it.
        dialog.innerHTML = `
          <h2>Add Git Project?</h2>
          <button>Add Git Project</button>
        `;
        findButtonByText(dialog, /add git project/i)?.addEventListener(
          "click",
          () => {
            steps.push("add-git-project");
            doc.body.innerHTML = "<span>Project added.</span>";
          },
        );
      },
    );
  }

  function createOrcaDocument(steps: string[]) {
    const doc = document;
    doc.body.innerHTML = `
      <h1>Add a project to get started.</h1>
      <button>Add Project</button>
    `;

    findButtonByText(doc, /^add project$/i)?.addEventListener("click", () => {
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
          renderFileBrowser(doc, dialog!, ["home", "orca"], steps);
        },
      );
    });

    return doc;
  }

  it("drives Orca's own Add Project dialog to open the cloned workspace path", async () => {
    const steps: string[] = [];
    const doc = createOrcaDocument(steps);
    const automateCalls: number[] = [];

    const result = await autoAddOrcaProject(doc, WORKSPACE_PATH, {
      timeoutMs: 2_000,
      onWillAutomate: () => automateCalls.push(Date.now()),
    });

    expect(result).toBe(true);
    expect(doc.body.textContent).toContain("Project added.");
    expect(automateCalls).toHaveLength(1);
    // Selects the connected runtime host (not the "Local Mac" default)
    // before browsing, clicks back to the filesystem root, then clicks
    // into each path segment in turn (filtering the listing by name first)
    // rather than typing the absolute path into the filter field directly.
    expect(steps).toEqual([
      "open-add-project-dialog",
      "open-host-picker",
      "select-host:CoDev Server Connected - CoDev server",
      `browse-folder:CoDev Server Connected - CoDev server`,
      "go-to-root",
      `filter:${WORKSPACE_PATH_SEGMENTS[0]}`,
      `navigate:${WORKSPACE_PATH_SEGMENTS[0]}`,
      `filter:${WORKSPACE_PATH_SEGMENTS[1]}`,
      `navigate:${WORKSPACE_PATH_SEGMENTS[1]}`,
      `filter:${WORKSPACE_PATH_SEGMENTS[2]}`,
      `navigate:${WORKSPACE_PATH_SEGMENTS[2]}`,
      `filter:${WORKSPACE_PATH_SEGMENTS[3]}`,
      `navigate:${WORKSPACE_PATH_SEGMENTS[3]}`,
      `select-folder:${WORKSPACE_PATH}`,
      "add-git-project",
    ]);
  });

  it("aborts without confirming if the browser lands on the wrong directory", async () => {
    // Regression test for the bug where the dialog silently fell through to
    // a default directory (e.g. /home/orca) instead of the cloned repo:
    // even if every segment click appears to succeed, this must never
    // click "Select folder" through unless the resolved directory the
    // dialog reports matches the workspace path exactly.
    const doc = document;
    doc.body.innerHTML = `
      <h1>Add a project to get started.</h1>
      <button aria-label="Add Project">+</button>
    `;
    doc
      .querySelector<HTMLButtonElement>('button[aria-label="Add Project"]')
      ?.addEventListener("click", () => {
        doc.body.insertAdjacentHTML(
          "beforeend",
          `<div role="dialog"><button role="combobox">CoDev Server Connected</button><button>Browse folder</button></div>`,
        );
        const dialog = doc.querySelector<HTMLElement>('[role="dialog"]');
        findButtonByText(dialog!, /browse folder/i)?.addEventListener(
          "click",
          () => {
            // Every segment appears clickable, but the dialog's resolved
            // path never actually changes — simulating a picker bug that
            // leaves it parked on an unrelated default directory.
            dialog!.innerHTML = `
              <button>/</button>
              <input placeholder="Type to filter or enter a path…" />
              <div>
                ${WORKSPACE_PATH_SEGMENTS.map(
                  (name) =>
                    `<button><span class="truncate flex-1 min-w-0">${name}</span></button>`,
                ).join("")}
              </div>
              <button title="/home/orca">Select folder</button>
            `;
          },
        );
      });

    const result = await autoAddOrcaProject(doc, WORKSPACE_PATH, {
      timeoutMs: 500,
      navigationStepTimeoutMs: 500,
    });

    expect(result).toBe(false);
    expect(doc.body.textContent).not.toContain("Project added.");
  });

  it("does nothing when Orca already has a project open", async () => {
    document.body.innerHTML = `
      <button>Add Project</button>
      <span class="titlebar-app-name-main">CoDev</span>
    `;

    const result = await autoAddOrcaProject(document, WORKSPACE_PATH, {
      timeoutMs: 200,
      emptyStateTimeoutMs: 200,
    });

    expect(result).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("aborts gracefully if the Add Project control never renders", async () => {
    document.body.innerHTML = "";

    const result = await autoAddOrcaProject(document, WORKSPACE_PATH, {
      timeoutMs: 200,
      emptyStateTimeoutMs: 200,
    });

    expect(result).toBe(false);
  });

  it("keeps polling past an iframe load event that fires before Orca has rendered anything", async () => {
    // Regression test: the iframe's `load` event fires as soon as its
    // scripts finish executing, before Orca's React app renders anything
    // (it still has to boot and negotiate the pairing connection). A naive
    // one-shot DOM check at that point would see an empty document and bail
    // out immediately instead of waiting for Orca to actually boot.
    document.body.innerHTML = "";
    const steps: string[] = [];

    const resultPromise = autoAddOrcaProject(document, WORKSPACE_PATH, {
      timeoutMs: 2_000,
      emptyStateTimeoutMs: 2_000,
    });

    // Simulate Orca's app finishing its boot/pairing sequence shortly after
    // the iframe's load event already fired with an empty document.
    setTimeout(() => createOrcaDocument(steps), 100);

    expect(await resultPromise).toBe(true);
    expect(document.body.textContent).toContain("Project added.");
  });
});
