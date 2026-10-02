"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const NEAR_BOTTOM_PX = 80;

/**
 * Stick-to-bottom for the Gen 2 transcript.
 *
 * The existing chat used `scrollIntoView` on a sentinel, which also moved
 * ancestor viewports and could not yield when the user scrolled up. This hook
 * scrolls only the transcript element. MessageScroller is not installed and
 * would change mount/scroll semantics for a client-fetched, full-thread load.
 */
export function useGen2ChatScroll(
  scrollerRef: RefObject<HTMLElement | null>,
  contentKey: unknown,
) {
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    stickRef.current = atBottom;
    setShowJump(!atBottom);
  }, [scrollerRef]);

  const jumpToLatest = useCallback(() => {
    const el = scrollerRef.current;
    stickRef.current = true;
    setShowJump(false);
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollerRef]);

  const pinToLatest = useCallback(() => {
    stickRef.current = true;
    setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [contentKey, scrollerRef]);

  return { onScroll, showJump, jumpToLatest, pinToLatest };
}
