"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

import type { TerminalTransport } from "./terminal-transport";
import { readTerminalTail } from "./workspace-terminal-tail";

export type TerminalQueuedInput = { id: string; text: string };
export type TerminalTailReader = () => string;

/**
 * What the workspace reads from and sends to one terminal pane, beyond the
 * member's own keys: a command queued for a brand-new session, typed once
 * the session is live (never into a session the member was already using),
 * and a reader for the lines on screen.
 */
export function useWorkspaceTerminalIo({
  live,
  termRef,
  transportRef,
  pendingInputRef,
  queuedInput,
  onTailReader,
}: {
  live: boolean;
  termRef: RefObject<Terminal | null>;
  transportRef: RefObject<TerminalTransport | null>;
  pendingInputRef: RefObject<string>;
  queuedInput: TerminalQueuedInput | null | undefined;
  onTailReader: ((read: TerminalTailReader | null) => void) | undefined;
}) {
  const sentRef = useRef<string | null>(null);
  const onTailReaderRef = useRef(onTailReader);

  useEffect(() => {
    onTailReaderRef.current = onTailReader;
  });

  useEffect(() => {
    if (!live || !queuedInput || sentRef.current === queuedInput.id) return;
    sentRef.current = queuedInput.id;
    const transport = transportRef.current;
    if (transport) transport.sendInput(queuedInput.text);
    else pendingInputRef.current += queuedInput.text;
  }, [live, queuedInput, transportRef, pendingInputRef]);

  useEffect(() => {
    if (!live) return;
    onTailReaderRef.current?.(() => {
      const term = termRef.current;
      return term ? readTerminalTail(term.buffer.active) : "";
    });
    return () => onTailReaderRef.current?.(null);
  }, [live, termRef]);
}
