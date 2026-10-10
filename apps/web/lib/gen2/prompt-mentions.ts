import { parseGen2PromptCommand } from "./prompt-command";

/**
 * @-mentions travel inside the prompt text as `@[label](kind:ref)` tokens, so
 * the persisted user message keeps them for history, continuations and the
 * transcript's chips. The composer shows `@label` and serializes on send.
 * Refs are percent-encoded so paths with spaces or parentheses survive.
 */
export const GEN2_MENTION_KINDS = [
  "file",
  "dir",
  "chat",
  "agent",
  "selection",
  "terminal",
] as const;

export type Gen2MentionKind = (typeof GEN2_MENTION_KINDS)[number];

export type Gen2Mention = { kind: Gen2MentionKind; ref: string; label: string };

export type Gen2MentionToken = Gen2Mention & { start: number; end: number };

const MAX_MENTIONS = 20;
const TOKEN =
  /@\[([^\]\n]{1,120})\]\((file|dir|chat|agent|selection|terminal):([A-Za-z0-9%._~-]{1,1024})\)/g;

export function encodeGen2MentionRef(raw: string) {
  return encodeURIComponent(raw).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function decodeGen2MentionRef(ref: string) {
  try {
    return decodeURIComponent(ref);
  } catch {
    return null;
  }
}

function cleanLabel(label: string) {
  return label
    .replace(/[[\]\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function formatGen2MentionToken({ kind, ref, label }: Gen2Mention) {
  return `@[${cleanLabel(label) || cleanLabel(ref) || kind}](${kind}:${encodeGen2MentionRef(ref)})`;
}

export function parseGen2MentionTokens(text: string): Gen2MentionToken[] {
  const seen = new Set<string>();
  const tokens: Gen2MentionToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const kind = match[2] as Gen2MentionKind;
    const ref = decodeGen2MentionRef(match[3]!);
    if (ref === null || seen.has(`${kind}:${ref}`)) continue;
    seen.add(`${kind}:${ref}`);
    const start = match.index;
    tokens.push({
      kind,
      ref,
      label: match[1]!,
      start,
      end: start + match[0].length,
    });
    if (tokens.length === MAX_MENTIONS) break;
  }
  return tokens;
}

/** Tokens back to `@label`, with the leading command removed: titles, recall. */
export function humanizeGen2Prompt(text: string) {
  return parseGen2PromptCommand(text).text.replace(TOKEN, "@$1");
}

function labelPattern(label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The label must end there: sentence punctuation may follow, a longer path
  // (`.tsx` after `.ts`) may not.
  return new RegExp(`(^|\\s)@${escaped}(?![\\w/-]|\\.[\\w/-])`);
}

/**
 * Replaces the first `@label` of each mention with its token. A mention whose
 * `@label` the member edited away is dropped. Longer labels go first so
 * `@src/a.ts` never claims the start of `@src/a.tsx`.
 */
export function serializeGen2Mentions(text: string, mentions: Gen2Mention[]) {
  return [...mentions]
    .sort((left, right) => right.label.length - left.label.length)
    .reduce((result, mention) => {
      const label = cleanLabel(mention.label);
      if (!label) return result;
      return result.replace(
        labelPattern(label),
        (_, lead: string) => `${lead}${formatGen2MentionToken(mention)}`,
      );
    }, text);
}

/** The inverse of `serializeGen2Mentions`, for restoring a failed draft. */
export function deserializeGen2Mentions(text: string) {
  const mentions = parseGen2MentionTokens(text).map(({ kind, ref, label }) => ({
    kind,
    ref,
    label,
  }));
  return { text: text.replace(TOKEN, "@$1"), mentions };
}
