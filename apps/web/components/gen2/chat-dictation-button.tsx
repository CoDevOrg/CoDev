"use client";

import { Mic } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Dictation } from "./use-dictation";
import { WorkspaceButton } from "./workspace-button";

function tooltip(dictation: Dictation) {
  if (dictation.phase === "listening")
    return dictation.mode === "local"
      ? "Stop dictation (on this device)"
      : "Stop dictation (browser speech service)";
  return dictation.phase === "idle" ? "Dictate" : "Stop dictation";
}

/**
 * The composer's mic. Its name stays "Dictation" and `aria-pressed` carries
 * the state, so a screen reader never hears "Stop dictation, pressed".
 * Hidden where the browser has no speech recognition.
 */
export function ChatDictationButton({ dictation }: { dictation: Dictation }) {
  if (!dictation.supported) return null;
  const active = dictation.phase !== "idle";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <WorkspaceButton
          size="icon"
          aria-label="Dictation"
          aria-pressed={active}
          data-recording={dictation.phase === "listening" || undefined}
          className="gen2-composer-mic"
          onClick={() => (active ? dictation.stop() : void dictation.start())}
        >
          <Mic aria-hidden="true" />
        </WorkspaceButton>
      </TooltipTrigger>
      <TooltipContent className="gen2-workspace-surface">
        {tooltip(dictation)}
      </TooltipContent>
    </Tooltip>
  );
}
