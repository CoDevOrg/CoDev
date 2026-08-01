"use client";

import { useEffect, useSyncExternalStore } from "react";

const THEME_KEY = "codev-theme";

type Theme = "light" | "dark";

function getTheme(): Theme {
  return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  window.addEventListener("codev-theme-change", onChange);
  return () => window.removeEventListener("codev-theme-change", onChange);
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_KEY, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.dispatchEvent(new Event("codev-theme-change"));
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      aria-pressed={theme === "dark"}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === "dark" ? "☼" : "☾"}</span>
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
