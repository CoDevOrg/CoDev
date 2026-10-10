import {
  StateEffect,
  StateField,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";

import { isAgentEditOrigin, remoteEdit } from "./codemirror-yjs-binding";

/** Above either limit an agent's edit appears at once with a flash. */
export const MAX_TYPED_CHARS = 2_000;
export const MAX_TYPED_HUNKS = 3;
const FLASH_MS = 1_500;

type Reveal = {
  id: string;
  label: string;
  color: string;
  from: number;
  to: number;
  startedAt: number;
  duration: number;
};
type Flash = { from: number; to: number; until: number };
type Typing = { reveals: Reveal[]; flashes: Flash[]; now: number };

const tick = StateEffect.define<number>();

/** Typing speed: about 80 characters a second, within a quarter to 1.2s. */
const durationFor = (length: number) =>
  Math.max(250, Math.min(length * 12, 1_200));

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** The new text's spans when an agent's edit arrives. */
function insertedRanges(transaction: Transaction) {
  const ranges: Array<{ from: number; to: number }> = [];
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (toB > fromB) ranges.push({ from: fromB, to: toB });
  });
  return ranges;
}

function startEdit(state: Typing, transaction: Transaction): Typing {
  const origin = transaction.annotation(remoteEdit)?.origin;
  if (!isAgentEditOrigin(origin)) return state;
  const ranges = insertedRanges(transaction);
  const total = ranges.reduce((sum, range) => sum + range.to - range.from, 0);
  const animate =
    total <= MAX_TYPED_CHARS &&
    ranges.length <= MAX_TYPED_HUNKS &&
    !prefersReducedMotion();
  const now = Date.now();
  if (!animate)
    return {
      ...state,
      flashes: [
        ...state.flashes,
        ...ranges.map((range) => ({ ...range, until: now + FLASH_MS })),
      ],
    };
  return {
    ...state,
    reveals: [
      ...state.reveals.filter((reveal) => reveal.id !== origin.id),
      ...ranges.map((range) => ({
        ...range,
        id: origin.id,
        label: origin.label,
        color: origin.color,
        startedAt: now,
        duration: durationFor(range.to - range.from),
      })),
    ],
  };
}

/** Keeps spans on their text; a member's own edit inside one ends it. */
function mapTyping(state: Typing, transaction: Transaction): Typing {
  if (!transaction.docChanged) return state;
  const local = transaction.annotation(remoteEdit) === undefined;
  let touched = false;
  if (local)
    transaction.changes.iterChangedRanges((fromA, toA) => {
      touched ||= state.reveals.some((r) => fromA <= r.to && toA >= r.from);
    });
  const map = <T extends { from: number; to: number }>(span: T) => ({
    ...span,
    from: transaction.changes.mapPos(span.from, 1),
    to: transaction.changes.mapPos(span.to, -1),
  });
  return {
    ...state,
    reveals: touched ? [] : state.reveals.map(map),
    flashes: state.flashes.map(map),
  };
}

export const agentTypingField = StateField.define<Typing>({
  create: () => ({ reveals: [], flashes: [], now: Date.now() }),
  update(value, transaction) {
    let next = startEdit(mapTyping(value, transaction), transaction);
    for (const effect of transaction.effects)
      if (effect.is(tick)) {
        const now = effect.value;
        next = {
          now,
          reveals: next.reveals.filter((r) => now < r.startedAt + r.duration),
          flashes: next.flashes.filter((f) => now < f.until),
        };
      }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (typing) => decorate(typing)),
});

/** Where a reveal's typing has reached at `now`. */
export function revealedTo(reveal: Reveal, now: number) {
  const progress = Math.min(
    1,
    Math.max(0, (now - reveal.startedAt) / reveal.duration),
  );
  return Math.round(reveal.from + (reveal.to - reveal.from) * progress);
}

class TypingCaret extends WidgetType {
  constructor(
    readonly label: string,
    readonly color: string,
  ) {
    super();
  }

  eq(other: TypingCaret) {
    return other.label === this.label && other.color === this.color;
  }

  toDOM() {
    const caret = document.createElement("span");
    caret.className = "cm-remote-caret cm-agent-typing-caret";
    caret.dataset.kind = "agent";
    caret.style.setProperty("--member-color", this.color);
    caret.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-remote-caret-label";
    label.textContent = this.label;
    caret.appendChild(label);
    return caret;
  }
}

function decorate({ reveals, flashes, now }: Typing) {
  const ranges: Range<Decoration>[] = [];
  for (const reveal of reveals) {
    const at = revealedTo(reveal, now);
    const caret = new TypingCaret(reveal.label, reveal.color);
    if (at > reveal.from)
      ranges.push(
        Decoration.mark({ class: "cm-agent-typed" }).range(reveal.from, at),
      );
    ranges.push(
      at < reveal.to
        ? Decoration.replace({ widget: caret }).range(at, reveal.to)
        : Decoration.widget({ widget: caret, side: 1 }).range(at),
    );
  }
  for (const flash of flashes)
    if (flash.to > flash.from)
      ranges.push(
        Decoration.mark({ class: "cm-agent-flash" }).range(
          flash.from,
          flash.to,
        ),
      );
  return Decoration.set(ranges, true);
}

/** Advances typing each frame while anything is animating. */
const typingClock = ViewPlugin.fromClass(
  class {
    frame: number | null = null;

    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (update.transactions.length) this.schedule();
    }

    schedule() {
      const { reveals, flashes } = this.view.state.field(agentTypingField);
      if (this.frame !== null || (!reveals.length && !flashes.length)) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.view.dispatch({ effects: tick.of(Date.now()) });
      });
    }

    destroy() {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
    }
  },
);

/** Shows an agent's edit being typed out; the document is already final. */
export const agentTyping = [agentTypingField, typingClock];
