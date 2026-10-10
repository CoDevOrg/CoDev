"use client";

import { useEffect, useState } from "react";

import { THEME_STORAGE_KEY } from "@/components/shell/theme-toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Preference = "system" | "light" | "dark";

/**
 * Same storage as the sidebar's light/dark toggle, plus "System", which the
 * toggle cannot return to once clicked: it clears the stored choice so the
 * CSS `prefers-color-scheme` rules apply again.
 */
export function ThemePreference() {
  const [preference, setPreference] = useState<Preference | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Blocked storage behaves like no stored choice.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreference(stored === "light" || stored === "dark" ? stored : "system");
  }, []);

  function choose(next: string) {
    if (next !== "system" && next !== "light" && next !== "dark") return;
    const root = document.documentElement;
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The choice still applies to this page load.
    }
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    setPreference(next);
  }

  return (
    <ToggleGroup
      aria-label="Theme"
      onValueChange={choose}
      type="single"
      value={preference ?? ""}
    >
      <ToggleGroupItem value="system">System</ToggleGroupItem>
      <ToggleGroupItem value="light">Light</ToggleGroupItem>
      <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
  );
}
