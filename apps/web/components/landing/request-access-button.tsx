"use client";

import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/button";

/** Fired when any "Get early access" control is pressed. */
export const REQUEST_ACCESS_EVENT = "codev:request-access";

/** Anchor the waitlist form so the buttons still work without JavaScript. */
export const REQUEST_ACCESS_TARGET_ID = "get-access";

/**
 * The hero and nav call-to-action. The event opens the inline form, centers it
 * in the viewport, and focuses the email field.
 */
export function RequestAccessButton({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <LinkButton
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
    </LinkButton>
  );
}
