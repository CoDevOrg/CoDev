import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  agentTyping,
  agentTypingField,
  MAX_TYPED_CHARS,
} from "./codemirror-agent-typing";
import { remoteCursors, setRemoteCursors } from "./codemirror-remote-cursors";
import { deltaToChanges, remoteEdit } from "./codemirror-yjs-binding";

const agent = {
  agent: true,
  id: "s1",
  label: "Claude · Alex’s turn",
  color: "#0d6fc4",
};

function editor(doc: string) {
  return EditorState.create({ doc, extensions: [agentTyping, remoteCursors] });
}

describe("deltaToChanges", () => {
  it("turns a multi-part Yjs delta into one CodeMirror change set", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "a\nb\nc\n");
    let delta: Y.YTextEvent["delta"] = [];
    text.observe((event) => {
      delta = event.delta;
    });
    doc.transact(() => {
      text.delete(2, 1);
      text.insert(2, "B");
      text.insert(6, "d\n");
    });
    const state = EditorState.create({ doc: "a\nb\nc\n" });
    const next = state.update({ changes: deltaToChanges(delta) }).state;
    expect(next.doc.toString()).toBe(text.toString());
  });
});

describe("agent typing", () => {
  it("hides an agent's new text and reveals it over time", () => {
    const state = editor("one\n").update({
      changes: { from: 4, insert: "two\n" },
      annotations: remoteEdit.of({ origin: agent }),
    }).state;
    const typing = state.field(agentTypingField);
    expect(typing.reveals).toEqual([
      expect.objectContaining({ id: "s1", from: 4, to: 8 }),
    ]);
    expect(state.doc.toString()).toBe("one\ntwo\n");
  });

  it("shows a large edit at once with a flash", () => {
    const state = editor("").update({
      changes: { from: 0, insert: "x".repeat(MAX_TYPED_CHARS + 1) },
      annotations: remoteEdit.of({ origin: agent }),
    }).state;
    expect(state.field(agentTypingField).reveals).toEqual([]);
    expect(state.field(agentTypingField).flashes).toHaveLength(1);
  });

  it("leaves a member's own edit alone and finishes typing it touches", () => {
    let state = editor("one\n").update({
      changes: { from: 4, insert: "two\n" },
      annotations: remoteEdit.of({ origin: agent }),
    }).state;
    state = state.update({ changes: { from: 0, insert: ">" } }).state;
    expect(state.field(agentTypingField).reveals[0]).toMatchObject({
      from: 5,
      to: 9,
    });
    state = state.update({ changes: { from: 6, insert: "!" } }).state;
    expect(state.field(agentTypingField).reveals).toEqual([]);
  });

  it("respects reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const state = editor("").update({
      changes: { from: 0, insert: "short" },
      annotations: remoteEdit.of({ origin: agent }),
    }).state;
    expect(state.field(agentTypingField).reveals).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("remote cursors", () => {
  it("draws labelled carets, clamped to the document, and hides a typing agent's", () => {
    const view = new EditorView({
      parent: document.body,
      state: editor("hello"),
    });
    view.dispatch({
      effects: setRemoteCursors.of([
        {
          id: "u1",
          label: "Sam",
          color: "#218358",
          kind: "person",
          anchor: 2,
          head: 99,
        },
        {
          id: "s1",
          label: agent.label,
          color: agent.color,
          kind: "agent",
          anchor: 0,
          head: 0,
        },
      ]),
    });
    const labels = () =>
      [...view.dom.querySelectorAll(".cm-remote-caret-label")].map(
        (el) => el.textContent,
      );
    expect(labels()).toEqual(expect.arrayContaining(["Sam", agent.label]));
    expect(view.dom.querySelector(".cm-remote-selection")?.textContent).toBe(
      "llo",
    );

    view.dispatch({
      changes: { from: 5, insert: " world" },
      annotations: remoteEdit.of({ origin: agent }),
    });
    // The agent's caret now sits where it is typing, not twice.
    expect(labels().filter((label) => label === agent.label)).toHaveLength(1);
    expect(view.dom.querySelector(".cm-agent-typing-caret")).not.toBeNull();
    view.destroy();
  });
});
