"use client";

import { useRef, useState, type DragEvent } from "react";

/** Drag-and-drop files onto the composer, tracking nested drag events. */
export function useComposerDrop(onFiles: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return {
    dragging,
    handlers: {
      onDragEnter(event: DragEvent<HTMLFormElement>) {
        event.preventDefault();
        depth.current += 1;
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      },
      onDragOver(event: DragEvent<HTMLFormElement>) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave(event: DragEvent<HTMLFormElement>) {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop(event: DragEvent<HTMLFormElement>) {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        onFiles(event.dataTransfer.files);
      },
    },
  };
}
