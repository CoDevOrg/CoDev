import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { mergeYjsState } from "./postgres-store";

function updateFor(key: string, value: string) {
  const document = new Y.Doc();
  document.getMap("state").set(key, value);
  return Y.encodeStateAsUpdate(document);
}

describe("PostgreSQL Hocuspocus state merging", () => {
  it("preserves concurrent Yjs updates while compacting binary state", () => {
    const merged = mergeYjsState(
      updateFor("first", "one"),
      updateFor("second", "two"),
    );
    const document = new Y.Doc();
    Y.applyUpdate(document, merged);

    expect(document.getMap("state").toJSON()).toEqual({
      first: "one",
      second: "two",
    });
  });
});
