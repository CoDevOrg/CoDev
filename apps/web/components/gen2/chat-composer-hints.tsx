"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Mic } from "lucide-react";

import { WorkspaceButton } from "./workspace-button";

const HINTS_KEY = "codev-gen2-composer-hints-used";
const HINTS_EVENT = "codev:composer-hints";

function hintsUsed() {
  try {
    return window.localStorage.getItem(HINTS_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(HINTS_EVENT, onChange);
  return () => window.removeEventListener(HINTS_EVENT, onChange);
}

/**
 * Teaches `/` and `@` until the member has used one: two inline buttons
 * that type the trigger and open its menu, plus the mic when dictation
 * works here. Hidden in narrow composers (see workspace-composer.css).
 */
export function ChatComposerHints({
  triggered,
  dictation,
  onInsert,
}: {
  /** A `/` or `@` menu is open, so the member has found them. */
  triggered: boolean;
  dictation: boolean;
  onInsert: (trigger: "/" | "@") => void;
}) {
  const used = useSyncExternalStore(subscribe, hintsUsed, () => false);

  useEffect(() => {
    if (!triggered || used) return;
    try {
      window.localStorage.setItem(HINTS_KEY, "1");
    } catch {
      return;
    }
    window.dispatchEvent(new Event(HINTS_EVENT));
  }, [triggered, used]);

  if (used) return null;
  return (
    <div className="gen2-composer-hints">
      <WorkspaceButton
        size="toolbar"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInsert("/")}
      >
        <kbd>/</kbd> Commands
      </WorkspaceButton>
      <WorkspaceButton
        size="toolbar"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInsert("@")}
      >
        <kbd>@</kbd> Mention
      </WorkspaceButton>
      {dictation ? (
        <span className="gen2-composer-hint-note">
          <Mic aria-hidden="true" /> Dictate with the mic
        </span>
      ) : null}
    </div>
  );
}
