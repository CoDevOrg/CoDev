"use client";

import { useState } from "react";

import {
  deserializeGen2Mentions,
  formatGen2MentionToken,
  serializeGen2Mentions,
  type Gen2Mention,
} from "@/lib/gen2/prompt-mentions";

/** A mention in the draft; selection and terminal ones carry their text. */
export type ComposerMention = Gen2Mention & { excerpt?: string | undefined };

export type ComposerText = { text: string; mentions: ComposerMention[] };

const MAX_PROMPT_CHARS = 20_000;

/** The label exactly as its token carries it (and the textarea shows it). */
function tokenLabel(mention: Gen2Mention) {
  const token = formatGen2MentionToken(mention);
  return token.slice(2, token.indexOf("]("));
}

function present(text: string, mention: Gen2Mention) {
  return serializeGen2Mentions(text, [mention]) !== text;
}

/** Where the mention's `@label` sits in the text, or -1. */
function labelIndex(text: string, mention: Gen2Mention) {
  const serialized = serializeGen2Mentions(text, [mention]);
  return serialized === text
    ? -1
    : serialized.indexOf(formatGen2MentionToken(mention));
}

/**
 * The composer's text and its @-mentions. The textarea shows `@label`; a side
 * map keeps each label's kind and ref, and `serialize` turns them into tokens
 * only when the turn is sent. Editing a label away drops its mention.
 */
export function useComposerMentions() {
  const [draft, setDraft] = useState<ComposerText>({ text: "", mentions: [] });

  function setText(text: string) {
    const next = text.slice(0, MAX_PROMPT_CHARS);
    setDraft((current) => ({
      text: next,
      mentions: current.mentions.filter((mention) => present(next, mention)),
    }));
  }

  /** Replaces `[start, end)` with `@label `; returns the caret after it. */
  function insertMention(mention: ComposerMention, start: number, end: number) {
    const taken = draft.mentions.filter(
      (entry) => entry.kind !== mention.kind || entry.ref !== mention.ref,
    );
    const base = tokenLabel(mention);
    let label = base;
    for (let n = 2; taken.some((entry) => entry.label === label); n += 1)
      label = `${base.slice(0, 116)} ${n}`;
    const insert = `@${label} `;
    const text = draft.text.slice(0, start) + insert + draft.text.slice(end);
    setDraft({ text, mentions: [...taken, { ...mention, label }] });
    return start + insert.length;
  }

  function removeMention(mention: ComposerMention) {
    const index = labelIndex(draft.text, mention);
    const length = mention.label.length + 1;
    const text =
      index < 0
        ? draft.text
        : draft.text.slice(0, index) +
          draft.text.slice(index + length).replace(/^ /, "");
    setDraft({
      text,
      mentions: draft.mentions.filter((entry) => entry !== mention),
    });
  }

  /** Loads text that may hold mention tokens (a draft, a recalled turn). */
  function fill(text: string, extra: ComposerMention[] = []) {
    const restored = deserializeGen2Mentions(text);
    setDraft({
      text: restored.text.slice(0, MAX_PROMPT_CHARS),
      mentions: [...restored.mentions, ...extra],
    });
  }

  return {
    text: draft.text,
    mentions: draft.mentions,
    setText,
    insertMention,
    removeMention,
    fill,
    /** Swaps in a saved draft (to restore one after a failed start). */
    replace: setDraft,
  };
}

export type ComposerMentions = ReturnType<typeof useComposerMentions>;
