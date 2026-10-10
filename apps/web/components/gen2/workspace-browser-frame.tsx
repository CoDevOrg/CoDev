"use client";

import { useEffect, useRef, type RefObject } from "react";

import { WORKSPACE_ACTIVITY_EVENT } from "./use-workspace-connection";

const KEEPALIVE_MS = 60_000;
/**
 * Previews are cross-site, so `allow-same-origin` grants them nothing of
 * the app's. They may not navigate the workspace itself (no top
 * navigation), and `allow=""` keeps camera and microphone off.
 */
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/**
 * Input inside a cross-origin frame never reaches this page, so while the
 * member works in the preview the frame reports activity itself. Preview
 * traffic (HMR, polling) never counts.
 */
function usePreviewKeepalive(
  frame: RefObject<HTMLIFrameElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const report = () => {
      if (
        document.visibilityState === "visible" &&
        frame.current !== null &&
        document.activeElement === frame.current
      )
        window.dispatchEvent(new Event(WORKSPACE_ACTIVITY_EVENT));
    };
    // Focus lands in the frame just after the window blurs.
    const entered = () => setTimeout(report, 0);
    window.addEventListener("blur", entered);
    const interval = setInterval(report, KEEPALIVE_MS);
    return () => {
      window.removeEventListener("blur", entered);
      clearInterval(interval);
    };
  }, [active, frame]);
}

/** The previewed page, plus a script-less frame that renews its session. */
export function WorkspaceBrowserFrame({
  url,
  port,
  active,
  refreshUrl,
  onLoad,
  onRefreshed,
}: {
  url: string;
  port: number;
  active: boolean;
  refreshUrl: string | null;
  onLoad(): void;
  onRefreshed(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  usePreviewKeepalive(frame, active);
  return (
    <>
      <iframe
        ref={frame}
        src={url}
        title="Workspace preview"
        className="gen2-browser-frame"
        sandbox={SANDBOX}
        referrerPolicy="no-referrer"
        allow=""
        onLoad={onLoad}
      />
      {refreshUrl ? (
        <iframe
          src={refreshUrl}
          title={`Preview session for :${port}`}
          className="gen2-browser-refresh"
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          aria-hidden="true"
          tabIndex={-1}
          onLoad={onRefreshed}
        />
      ) : null}
    </>
  );
}
