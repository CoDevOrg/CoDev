"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { Button } from "@/components/ui/button";
import {
  ANALYTICS_COOKIE,
  analyticsAllowed,
  analyticsPath,
} from "@/lib/platform/privacy-preferences";
import { VisitTracker } from "./visit-tracker";

function hasPrivacySignal() {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true || navigator.doNotTrack === "1"
  );
}

// After a choice, the reopen button lives only on the cookie notice.
const COOKIE_NOTICE_PATH = "/legal/cookies";

export function PrivacyChoices() {
  const onCookieNotice = usePathname() === COOKIE_NOTICE_PATH;
  const [allowed, setAllowed] = useState(false);
  const [show, setShow] = useState(false);
  const [signal, setSignal] = useState(false);
  useEffect(() => {
    const sync = () => {
      const optedOut = hasPrivacySignal();
      setSignal(optedOut);
      setAllowed(analyticsAllowed(document.cookie, optedOut));
      setShow(
        !optedOut &&
          !document.cookie
            .split(";")
            .some((part) =>
              /^codev_analytics=(allowed|denied)$/.test(part.trim()),
            ),
      );
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
  function choose(value: boolean) {
    document.cookie = `${ANALYTICS_COOKIE}=${value ? "allowed" : "denied"}; Path=/; Max-Age=15552000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setAllowed(value && !hasPrivacySignal());
    setShow(false);
  }
  return (
    <>
      {allowed ? (
        <>
          <Analytics
            beforeSend={(event) =>
              analyticsAllowed(document.cookie, hasPrivacySignal())
                ? {
                    ...event,
                    url: new URL(analyticsPath(event.url), location.origin)
                      .href,
                  }
                : null
            }
          />
          <Suspense fallback={null}>
            <VisitTracker />
          </Suspense>
        </>
      ) : null}
      {show ? (
        <section aria-label="Privacy choices" className="privacy-banner">
          <h2 className="font-semibold">Your privacy choices</h2>
          <p className="text-sm text-muted-foreground">
            Essential storage keeps sign-in and settings working. May we also
            use optional analytics to understand visits? You can change this
            choice at any time.{" "}
            <Link className="underline" href="/legal/cookies">
              Cookie notice
            </Link>
          </p>
          {signal ? (
            <p className="text-sm">
              Your browser privacy signal keeps analytics off.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => choose(false)}>
              Reject analytics
            </Button>
            <Button
              variant="outline"
              disabled={signal}
              onClick={() => choose(true)}
            >
              Allow analytics
            </Button>
          </div>
        </section>
      ) : !onCookieNotice ? null : (
        <Button
          className="privacy-reopen"
          variant="outline"
          size="xs"
          onClick={() => {
            setSignal(hasPrivacySignal());
            setShow(true);
          }}
        >
          Privacy choices
        </Button>
      )}
    </>
  );
}
