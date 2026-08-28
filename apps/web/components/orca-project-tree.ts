/**
 * A CoDev workspace is one repository, so the IDE's "Projects" section listed
 * a single row and a button to add a second project that CoDev does not
 * support. That space now belongs to the team rail, so the section is hidden
 * inside the vendored iframe.
 *
 * This works on the loaded document rather than through the Orca patch on
 * purpose: it targets Orca's own authored class names (`.sidebar-header`,
 * `.worktree-list`), and every step is independent, so a future upstream
 * rename degrades to leaving one element visible instead of breaking the IDE.
 */

const PROJECTS_HEADER_PATTERN = /^projects?$/i;
const WORKTREE_LIST_SELECTOR = ".worktree-list";
const SIDEBAR_HEADER_SELECTOR = ".sidebar-header";
const ADD_PROJECT_SELECTORS = [
  '[aria-label="Add Project"]',
  '[aria-label="Open folder picker to add a project"]',
].join(", ");

function hide(element: HTMLElement) {
  if (element.dataset.codevHidden === "project-tree") return false;
  element.dataset.codevHidden = "project-tree";
  element.style.display = "none";
  return true;
}

/**
 * Hides the project tree wherever it currently exists. Idempotent, and safe to
 * call on a document that has not rendered the sidebar yet.
 *
 * Returns the number of elements hidden by this call, which the caller uses
 * only for tests and diagnostics — a zero is a normal early-boot result.
 */
export function hideOrcaProjectTree(doc: Document) {
  let hidden = 0;

  const worktreeLists = doc.querySelectorAll<HTMLElement>(
    WORKTREE_LIST_SELECTOR,
  );
  worktreeLists.forEach((list) => {
    if (hide(list)) hidden += 1;
  });

  doc
    .querySelectorAll<HTMLElement>(SIDEBAR_HEADER_SELECTOR)
    .forEach((header) => {
      if (!PROJECTS_HEADER_PATTERN.test(header.textContent?.trim() ?? ""))
        return;
      if (hide(header)) hidden += 1;
    });

  // Only once a project is actually open. Before that, CoDev's own bootstrap
  // clicks this very button to open the workspace clone, and the empty state
  // is the member's only recovery path if that fails.
  if (worktreeLists.length > 0) {
    doc
      .querySelectorAll<HTMLElement>(ADD_PROJECT_SELECTORS)
      .forEach((button) => {
        if (hide(button)) hidden += 1;
      });
  }

  return hidden;
}

/**
 * Keeps the project tree hidden for as long as the iframe lives. Orca
 * re-renders the sidebar on every worktree change, so a single pass is not
 * enough and there is no point at which watching can stop.
 */
export function watchOrcaProjectTree(doc: Document) {
  hideOrcaProjectTree(doc);
  if (!doc.body || typeof MutationObserver === "undefined") {
    return () => undefined;
  }
  const observer = new MutationObserver(() => {
    hideOrcaProjectTree(doc);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
