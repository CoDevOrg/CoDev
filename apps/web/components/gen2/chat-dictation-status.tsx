"use client";

import type { Dictation } from "./use-dictation";
import { WorkspaceButton } from "./workspace-button";

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * One line under the textarea while dictation is busy: the cloud consent
 * question, the speech model download, or the recording timer with the
 * words heard so far.
 */
export function ChatDictationStatus({ dictation }: { dictation: Dictation }) {
  if (dictation.phase === "consent")
    return (
      <div className="gen2-composer-dictation" data-phase="consent">
        <span>
          Dictation in this browser sends audio to Google/Apple speech services.
          Continue?
        </span>
        <WorkspaceButton size="toolbar" onClick={dictation.acceptConsent}>
          Continue
        </WorkspaceButton>
        <WorkspaceButton size="toolbar" onClick={dictation.declineConsent}>
          Not now
        </WorkspaceButton>
      </div>
    );
  if (dictation.phase === "installing" || dictation.phase === "checking")
    return (
      <div
        className="gen2-composer-dictation"
        role="status"
        data-phase="installing"
      >
        <span>
          {dictation.phase === "installing"
            ? "Downloading speech model…"
            : "Starting dictation…"}
        </span>
        <WorkspaceButton size="toolbar" onClick={() => dictation.stop()}>
          Cancel
        </WorkspaceButton>
      </div>
    );
  if (dictation.phase !== "listening") return null;
  return (
    <div
      className="gen2-composer-dictation"
      role="status"
      data-phase="listening"
    >
      <span className="gen2-composer-dictation-dot" aria-hidden="true" />
      <span className="gen2-composer-dictation-time">
        {clock(dictation.elapsed)}
      </span>
      <span className="gen2-composer-dictation-text">
        {dictation.interim || "Listening…"}
      </span>
    </div>
  );
}
