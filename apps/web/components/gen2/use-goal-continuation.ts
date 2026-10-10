"use client";

import { useEffect, useRef, useState } from "react";
import type { Gen2ChatGoal } from "@codev/contracts";

import type { ChatTurnOutcome } from "./use-chat-turn";

export const GOAL_CONTINUE_PROMPT = "Continue working toward the goal.";
export const MAX_GOAL_TURNS = 5;
const COUNTDOWN_SECONDS = 5;

/**
 * "Keep going" for a chat goal: opt-in, and bounded. After a turn this tab
 * drove settles cleanly with the goal still active, it counts down and
 * sends a Continue turn, at most five times. Achieving or clearing the
 * goal, Stop, a chat switch, a hidden tab or a lost connection ends it.
 */
export function useGoalContinuation({
  goal,
  chatId,
  connected,
  onContinue,
}: {
  goal: Gen2ChatGoal | null;
  chatId: string | null;
  connected: boolean;
  onContinue: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [turns, setTurns] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [seenChat, setSeenChat] = useState(chatId);
  if (seenChat !== chatId) {
    setSeenChat(chatId);
    setEnabled(false);
    setTurns(0);
    setCountdown(null);
  }
  const active = goal?.status === "active";
  if (countdown !== null && (!enabled || !active || !connected || hidden))
    setCountdown(null);

  const continueRef = useRef(onContinue);
  useEffect(() => {
    continueRef.current = onContinue;
  });

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const counting = countdown !== null;
  useEffect(() => {
    if (!counting) return;
    let remaining = COUNTDOWN_SECONDS;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) return setCountdown(remaining);
      window.clearInterval(timer);
      setCountdown(null);
      setTurns((count) => count + 1);
      continueRef.current();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [counting]);

  /** Arms the next automatic turn when the one that just ended allows it. */
  function onSettled(outcome: ChatTurnOutcome) {
    if (
      !enabled ||
      !active ||
      !connected ||
      outcome.status !== "completed" ||
      outcome.chatId !== chatId ||
      turns >= MAX_GOAL_TURNS ||
      document.visibilityState === "hidden"
    )
      return;
    setCountdown(COUNTDOWN_SECONDS);
  }

  return {
    enabled,
    setEnabled(next: boolean) {
      setEnabled(next);
      setTurns(0);
      if (!next) setCountdown(null);
    },
    countdown,
    turns,
    stop() {
      setCountdown(null);
      setEnabled(false);
    },
    onSettled,
  };
}

export type GoalContinuation = ReturnType<typeof useGoalContinuation>;
