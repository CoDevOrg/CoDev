"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_STORAGE_KEY = "codev-theme";

/**
 * Inline, blocking script for the root layout's <head>. Reads a stored
 * explicit preference and stamps `data-theme` before first paint, so a
 * returning visitor who chose dark never sees a light flash. When nothing is
 * stored (the common case), this does nothing and the CSS's own
 * `prefers-color-scheme` media query decides -- that path is already
 * synchronous with paint and needs no script at all.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped === "light" || stamped === "dark") return stamped;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * A visible light/dark switch, not a menu item -- discoverability was the
 * point, so it sits in the nav next to the profile menu rather than inside
 * it. Once clicked it pins an explicit choice to `data-theme` + localStorage;
 * until then, the theme just follows the OS via CSS alone.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // Starts `null` so the server-rendered and first-client-render markup
  // match (the real theme is only knowable in the browser); the real icon
  // appears a tick later without ever showing the wrong one.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Reads `document`/`window`, which don't exist during SSR -- the value
    // can only ever be known once mounted in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readInitialTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Private browsing or a blocked store -- the toggle still works for
         this page load, it just won't be remembered next visit. */
    }
    setTheme(next);
  }

  const label =
    theme === null
      ? "Toggle color theme"
      : theme === "dark"
        ? "Switch to light theme"
        : "Switch to dark theme";

  return (
    <button
      type="button"
      className={`theme-toggle${compact ? " theme-toggle-compact" : ""}`}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={16} />
      ) : (
        <Moon aria-hidden="true" size={16} />
      )}
    </button>
  );
}
