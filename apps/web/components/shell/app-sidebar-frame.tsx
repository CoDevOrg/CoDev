"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const STORAGE_KEY = "codev.app-sidebar.collapsed";
const SIDEBAR_ID = "app-sidebar";

const listeners = new Set<() => void>();
// Used when storage is blocked, so the toggle still works for this page view.
let memoryCollapsed = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return memoryCollapsed;
  }
}

function setCollapsedPreference(next: boolean) {
  memoryCollapsed = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Not persisted; the in-memory value still applies.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Lays out the app sidebar and its content, and lets the member hide the
 * sidebar to give the page the full width. The choice is remembered per
 * browser. The sidebar itself stays server-rendered and is passed in; a hidden
 * sidebar is removed from the layout (`display: none`), so it cannot be
 * reached by keyboard while collapsed.
 */
export function AppSidebarFrame({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  // The server always renders the sidebar open; the stored choice applies
  // after hydration.
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const toggle = () => setCollapsedPreference(!collapsed);

  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div
      className={`app-page app-with-sidebar${collapsed ? " is-sidebar-collapsed" : ""}`}
    >
      {sidebar}
      <div className="app-sidebar-rail">
        <button
          aria-controls={SIDEBAR_ID}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
          className="app-sidebar-toggle"
          onClick={toggle}
          title={collapsed ? "Show sidebar" : "Hide sidebar"}
          type="button"
        >
          <Icon aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="app-sidebar-content">{children}</div>
    </div>
  );
}
