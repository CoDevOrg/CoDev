"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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
  const [mounted, setMounted] = useState(false);
  const rawTheme = useSyncExternalStore(subscribe, getTheme, () => "light");
  const theme = mounted ? rawTheme : "light";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.dataset.theme = rawTheme;
    }
  }, [mounted, rawTheme]);

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
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb" />
      </span>
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
