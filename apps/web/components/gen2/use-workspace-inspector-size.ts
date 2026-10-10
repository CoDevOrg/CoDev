"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePanelRef } from "react-resizable-panels";

const EXPANDED = "65%";

/**
 * The inspector's width while the Browser tab shows a preview. A preview
 * gets room to grow (up to 75%, the chat keeping 420px), and "Expand
 * preview" resizes the panel rather than moving the frame, so the previewed
 * app keeps its state. Other tabs get the width the member had; coming back
 * to an expanded preview widens the panel again, so the pane's Expand
 * button always tells the truth.
 */
export function useWorkspaceInspectorSize(browserActive: boolean) {
  const panelRef = usePanelRef();
  const restoreTo = useRef<number | null>(null);
  const expanded = useRef(false);

  const apply = useCallback(
    (wide: boolean) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (wide) {
        restoreTo.current ??= panel.getSize().inPixels;
        panel.resize(EXPANDED);
        return;
      }
      if (restoreTo.current === null) return;
      panel.resize(restoreTo.current);
      restoreTo.current = null;
    },
    [panelRef],
  );

  const onExpandChange = useCallback(
    (next: boolean) => {
      expanded.current = next;
      apply(next);
    },
    [apply],
  );

  useEffect(() => {
    apply(browserActive && expanded.current);
  }, [browserActive, apply]);

  return {
    panelRef,
    onExpandChange,
    maxSize: browserActive ? "75%" : "480px",
    centerMinSize: browserActive ? "420px" : "240px",
  };
}
