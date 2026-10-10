import { describe, expect, it } from "vitest";
import {
  gen2ChatMessageSchema,
  type Gen2TurnItem,
  type Gen2TurnState,
} from "@codev/contracts";

import { reduceGen2Turn } from "./turn-reducer";
import {
  extractGen2WorkspaceActions,
  scanGen2ActionBlocks,
} from "./workspace-action-extract";

const TOKEN = "abc123defg";
const block = (json: string, token = TOKEN) =>
  `\`\`\`codev-action ${token}\n${json}\n\`\`\``;
const OPEN_FILE = block('{"type":"open_file","path":"src/app.ts","line":4}');
const INVITE = block('{"type":"invite_members","people":["ada"]}');

const ndjson = (...events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join("\n");

function message(text: string, id = "m1"): Gen2TurnItem {
  return { id, kind: "message", status: "completed", text };
}

function state(
  items: Gen2TurnItem[],
  reply: string,
  status: Gen2TurnState["status"] = "completed",
): Gen2TurnState {
  return { items, reply, status, error: null, usage: null };
}

function actions(turn: Gen2TurnState) {
  return turn.items.filter((item) => item.kind === "workspaceAction");
}

/** Every prefix of the stream, as the browser re-reduces it per poll. */
function prefixes(stream: string) {
  const lines = stream.split("\n");
  return lines.map((_, index) => lines.slice(0, index + 1).join("\n"));
}

const CODEX = [
  `{"type":"thread.started","thread_id":"th_1"}`,
  `{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Looking"}}`,
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_1",
      type: "agent_message",
      text: `The bug is in the router.\n\n${OPEN_FILE}`,
    },
  }),
  JSON.stringify({
    type: "item.completed",
    item: { id: "item_2", type: "agent_message", text: INVITE },
  }),
  `{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}`,
].join("\n");

const CLAUDE = ndjson(
  {
    type: "assistant",
    message: {
      id: "msg_1",
      content: [
        { type: "text", text: `Here it is.\r\n\r\n${OPEN_FILE}` },
        { type: "text", text: "All set." },
      ],
    },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "All set.",
  },
);

const cursorSegment = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});
const CURSOR_SEGMENTS = [
  `I found it.\n\n${OPEN_FILE}`,
  "Next I ran the tests.",
  INVITE,
  "Done.",
];
const CURSOR = ndjson(...CURSOR_SEGMENTS.map(cursorSegment), {
  type: "result",
  subtype: "success",
  is_error: false,
  result: CURSOR_SEGMENTS.join(""),
});

describe("scanGen2ActionBlocks", () => {
  it("lifts a block out of the prose", () => {
    expect(
      scanGen2ActionBlocks(`Look.\n\n${OPEN_FILE}\n\nThen.`, false),
    ).toEqual({
      prose: "Look.\n\nThen.",
      blocks: [
        {
          token: TOKEN,
          body: '{"type":"open_file","path":"src/app.ts","line":4}',
        },
      ],
      changed: true,
    });
  });

  it("keeps prose glued after a closing fence on its own line", () => {
    const scan = scanGen2ActionBlocks(`${OPEN_FILE}Next step.`, false);
    expect(scan.blocks).toHaveLength(1);
    expect(scan.prose).toBe("Next step.");
  });

  it("ignores blocks inside another fence or a blockquote", () => {
    const nested = `\`\`\`\`markdown\n${OPEN_FILE}\n\`\`\`\``;
    const tilde = `~~~\n${OPEN_FILE}\n~~~`;
    const quoted = OPEN_FILE.split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    for (const text of [nested, tilde, quoted]) {
      expect(scanGen2ActionBlocks(text, false)).toEqual({
        prose: text,
        blocks: [],
        changed: false,
      });
    }
  });

  it("requires the opening fence at the start of a line", () => {
    for (const text of [`  ${OPEN_FILE}`, `- ${OPEN_FILE}`]) {
      expect(scanGen2ActionBlocks(text, false).blocks).toEqual([]);
    }
  });

  it("starts a block once a quoted fence ends with its quote", () => {
    const text = `> \`\`\`js\n> code\n${OPEN_FILE}`;
    expect(scanGen2ActionBlocks(text, false).blocks).toHaveLength(1);
  });

  it("drops a block still streaming, and keeps it as text once the turn ends", () => {
    const partial = `Opening it.\n\n\`\`\`codev-action ${TOKEN}\n{"type":"open`;
    expect(scanGen2ActionBlocks(partial, true)).toMatchObject({
      prose: "Opening it.",
      blocks: [],
      changed: true,
    });
    expect(scanGen2ActionBlocks(partial, false)).toMatchObject({
      prose: partial,
      changed: false,
    });
  });
});

describe("extractGen2WorkspaceActions", () => {
  it("inserts an item after its message with a turn-scoped id", () => {
    const turn = extractGen2WorkspaceActions(
      state([message(`Look.\n\n${OPEN_FILE}`)], `Look.\n\n${OPEN_FILE}`),
    );
    expect(turn.items).toEqual([
      message("Look."),
      {
        id: "m1:action:0",
        kind: "workspaceAction",
        status: "completed",
        token: TOKEN,
        action: { type: "open_file", path: "src/app.ts", line: 4 },
        error: null,
      },
    ]);
    expect(turn.reply).toBe("Look.");
  });

  it("reports short, fixed errors for invalid blocks", () => {
    const text = [
      block("{nope"),
      block('{"type":"launch_rockets"}'),
      block('{"type":"open_file","path":"/etc/passwd"}'),
      block("[1]"),
    ].join("\n\n");
    const errors = actions(
      extractGen2WorkspaceActions(state([message(text)], text)),
    ).map((item) => item.kind === "workspaceAction" && item.error);
    expect(errors).toEqual([
      "Invalid JSON.",
      "Unknown action type.",
      "path: Use a path relative to the project root.",
      "Unknown action type.",
    ]);
  });

  it("keeps at most eight actions per turn and reports the rest once", () => {
    const many = Array.from({ length: 5 }, () => OPEN_FILE).join("\n\n");
    const turn = extractGen2WorkspaceActions(
      state([message(many, "a"), message(many, "b")], many),
    );
    const found = actions(turn);
    expect(found).toHaveLength(9);
    expect(found.at(-1)).toMatchObject({
      id: "b:action:3",
      action: null,
      error: "Too many workspace actions in one turn.",
    });
  });

  it("falls back to earlier prose, then to a sentence, for an action-only reply", () => {
    const prose = extractGen2WorkspaceActions(
      state(
        [message("Fixed the router.", "a"), message(OPEN_FILE, "b")],
        OPEN_FILE,
      ),
    );
    expect(prose.reply).toBe("Fixed the router.");
    const alone = extractGen2WorkspaceActions(
      state([message(`${OPEN_FILE}\n${INVITE}`)], OPEN_FILE),
    );
    expect(alone.reply).toBe(
      "Opened `src/app.ts`. Suggested inviting 1 person.",
    );
    const running = extractGen2WorkspaceActions(
      state([message(OPEN_FILE)], OPEN_FILE, "running"),
    );
    expect(running.reply).toBe("");
  });

  it("leaves a failed turn's error as its body", () => {
    const failed = extractGen2WorkspaceActions({
      ...state([message(OPEN_FILE)], OPEN_FILE, "failed"),
      error: "Rate limited.",
    });
    expect(failed.reply).toBe("");
  });

  it("returns the same state when there is nothing to extract", () => {
    const plain = state([message("Hello")], "Hello");
    expect(extractGen2WorkspaceActions(plain)).toBe(plain);
  });
});

describe("workspace actions in provider streams", () => {
  it.each([
    ["codex", CODEX],
    ["claude", CLAUDE],
    ["cursor", CURSOR],
  ] as const)(
    "%s: is idempotent over every accumulated prefix",
    (provider, stream) => {
      for (const prefix of prefixes(stream)) {
        const once = reduceGen2Turn(provider, prefix);
        expect(extractGen2WorkspaceActions(once)).toEqual(once);
        expect(once.reply).not.toContain("codev-action");
        for (const item of once.items) {
          if (item.kind === "message")
            expect(item.text).not.toContain("codev-action");
        }
      }
    },
  );

  it.each([
    ["codex", CODEX],
    ["claude", CLAUDE],
    ["cursor", CURSOR],
  ] as const)(
    "%s: items round-trip through the chat message schema",
    (provider, stream) => {
      const turn = reduceGen2Turn(provider, stream);
      const parsed = gen2ChatMessageSchema.parse({
        id: "8c6f1f8e-8f43-4f7c-9a52-2b8b6f1e2a10",
        role: "assistant",
        body: turn.reply,
        items: turn.items,
        createdAt: new Date().toISOString(),
      });
      expect(parsed.items).toEqual(turn.items);
    },
  );

  it("codex: keeps prose and lifts each message's actions", () => {
    const turn = reduceGen2Turn("codex", CODEX);
    expect(turn.items.map((item) => item.id)).toEqual([
      "item_0",
      "item_1",
      "item_1:action:0",
      "item_2",
      "item_2:action:0",
    ]);
    expect(turn.reply).toBe("The bug is in the router.");
  });

  it("claude: handles CRLF text blocks", () => {
    const turn = reduceGen2Turn("claude", CLAUDE);
    expect(actions(turn)).toMatchObject([
      { id: "msg_1:0:action:0", action: { type: "open_file" } },
    ]);
    expect(turn.reply).toBe("All set.");
  });

  it("cursor: rebuilds a glued reply from the stripped segments", () => {
    const turn = reduceGen2Turn("cursor", CURSOR);
    expect(actions(turn)).toHaveLength(2);
    expect(turn.reply).toBe("I found it.\n\nNext I ran the tests.\n\nDone.");
  });
});
