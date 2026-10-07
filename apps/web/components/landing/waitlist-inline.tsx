"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

import {
  REQUEST_ACCESS_EVENT,
  REQUEST_ACCESS_TARGET_ID,
} from "@/components/landing/request-access-button";
import { RequestAccessForm } from "@/components/landing/request-access-form";

export function WaitlistInline() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [requestCount, setRequestCount] = useState(0);

  // The hero and nav "Join the waitlist" buttons scroll the page down to this
  // form and drop the caret in the email field.
  useEffect(() => {
    const onRequest = () => {
      setOpen(true);
      setRequestCount((count) => count + 1);
    };
    window.addEventListener(REQUEST_ACCESS_EVENT, onRequest);
    if (window.location.hash === `#${REQUEST_ACCESS_TARGET_ID}`) onRequest();
    return () => window.removeEventListener(REQUEST_ACCESS_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (requestCount === 0) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const card =
      wrapRef.current?.querySelector<HTMLDivElement>(".lp-waitlist-card");
    if (!card) return;
    card.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
    const focusTimer = window.setTimeout(
      () => {
        wrapRef.current
          ?.querySelector<HTMLInputElement>('input[name="email"]')
          ?.focus({ preventScroll: true });
      },
      reduced ? 0 : 460,
    );
    return () => window.clearTimeout(focusTimer);
  }, [requestCount]);

  return (
    <div className="lp-waitlist" id={REQUEST_ACCESS_TARGET_ID} ref={wrapRef}>
      <Button
        size="lg"
        className="lp-cta lp-cta-primary"
        aria-expanded={open}
        aria-controls="landing-waitlist-form"
        onClick={() =>
          window.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT))
        }
      >
        Enter the waitlist <span aria-hidden="true">→</span>
      </Button>
      <div
        className="lp-waitlist-card"
        id="landing-waitlist-form"
        hidden={!open}
      >
        <div className="lp-waitlist-header">
          <span className="lp-waitlist-label">CODEV · PRIVATE BETA</span>
          <h3 className="lp-waitlist-intro">A place for your next big idea.</h3>
          <p>
            Leave your email. We’ll invite you when your workspace is ready.
          </p>
        </div>
        <RequestAccessForm />
      </div>
    </div>
  );
}
