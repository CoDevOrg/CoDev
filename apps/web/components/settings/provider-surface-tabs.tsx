"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/platform/utils";

export type ProviderSurfaceTab = {
  id: string;
  label: string;
  description: string;
  content: ReactNode;
};

/**
 * Segmented tabs for the two provider-integration surfaces, so a member never
 * has to scroll past one section to reach the other. Only the active tab's
 * cards are mounted — the inactive surface's cards (Cursor's poll timer,
 * in-flight OAuth flows) have no reason to run while hidden.
 *
 * Reads the initial tab from the URL hash once on mount, so an existing link
 * to `#coding-workspaces` (the workspace-start preflight banner) still opens
 * on that tab instead of landing on the default with nothing to scroll to.
 */
export function ProviderSurfaceTabs({ tabs }: { tabs: ProviderSurfaceTab[] }) {
  const [active, setActive] = useState(tabs[0]!.id);

  useEffect(() => {
    // Syncing from an external system (the URL) on mount — not derived from
    // props/state, so this is the effect body the lint rule itself
    // recommends, not the render-derived case it warns against. A lazy
    // `useState` initializer would read `window` during the client's
    // hydration render and mismatch the server-rendered default tab.
    const fromHash = window.location.hash.replace("#", "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabs.some((tab) => tab.id === fromHash)) setActive(fromHash);
    // Read the hash once, at mount, the way a page anchor normally would —
    // not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;

  return (
    <div className="space-y-3">
      <div
        aria-label="Provider integration surface"
        className="inline-flex gap-1 rounded-lg border border-border/60 bg-muted/40 p-1"
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-controls={`${tab.id}-panel`}
            aria-selected={tab.id === active}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab.id === active
                ? "bg-primary shadow-xs"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
            id={`${tab.id}-tab`}
            key={tab.id}
            onClick={() => {
              setActive(tab.id);
              window.history.replaceState(null, "", `#${tab.id}`);
            }}
            role="tab"
            type="button"
            // The app's global reset sets `button { color: inherit }` as
            // plain, unlayered CSS, which always beats the layered
            // `text-primary-foreground` utility — see button.tsx's own
            // VARIANT_TEXT_COLOR workaround for the same issue.
            style={
              tab.id === active
                ? { color: "var(--color-primary-foreground)" }
                : undefined
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{current.description}</p>
      <div
        aria-labelledby={`${current.id}-tab`}
        className="space-y-3"
        id={`${current.id}-panel`}
        role="tabpanel"
      >
        {current.content}
      </div>
    </div>
  );
}
