"use client";

import type { ReactNode } from "react";

/** Fired when any "Get early access" control is pressed. */
export const REQUEST_ACCESS_EVENT = "codev:request-access";

/** Anchor the waitlist form so the buttons still work without JavaScript. */
export const REQUEST_ACCESS_TARGET_ID = "get-access";

/**
 * The hero and nav call-to-action. Rather than opening a modal it points at the
 * inline waitlist form near the foot of the page: the anchor scrolls there on
 * its own, and the event tells the form to open and take focus.
 */
export function RequestAccessButton({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <a
      className={className}
      href={`#${REQUEST_ACCESS_TARGET_ID}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT));
      }}
    >
      {children}
    </a>
  );
}
