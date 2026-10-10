"use client";

import type { CSSProperties } from "react";

import { WorkspaceButton } from "./workspace-button";
import type { FollowPosition } from "./use-workspace-follow";

/** A frame in the followed member's colour, with a way to stop. */
export function WorkspaceFollowFrame({
  position,
  onStop,
}: {
  position: FollowPosition;
  onStop: () => void;
}) {
  return (
    <div
      className="gen2-follow-frame"
      style={{ "--member-color": position.color } as CSSProperties}
    >
      <div className="gen2-follow-chip" role="status">
        <span>Following {position.label}</span>
        <WorkspaceButton tone="secondary" onClick={onStop}>
          Stop · Esc
        </WorkspaceButton>
      </div>
    </div>
  );
}
