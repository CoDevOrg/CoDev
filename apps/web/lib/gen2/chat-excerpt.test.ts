import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real query builder against a recording client, so the test sees the
 * SQL that runs: one statement, scoped by the chat's workspace.
 */
const database = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; values: unknown[] }>,
  rows: [] as unknown[][],
}));

vi.mock("../platform/database", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { schema } = await import("@codev/db");
  const client = {
    query: async (config: { text: string }, values: unknown[]) => {
      database.queries.push({ text: config.text, values });
      return { rows: database.rows, rowCount: database.rows.length };
    },
  };
  return { getDatabase: () => drizzle({ client: client as never, schema }) };
});

import { readGen2ChatExcerpt } from "./chat-excerpt";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const chatId = "55555555-5555-4555-8555-555555555555";

describe("chat excerpt", () => {
  beforeEach(() => {
    database.queries = [];
    database.rows = [];
  });

  it("reads the newest messages in one query scoped to the workspace", async () => {
    database.rows = [
      ["Auth notes", "assistant", "Through OAuth."],
      ["Auth notes", "user", "How does @[login.ts](file:src%2Flogin.ts) work?"],
    ];
    await expect(readGen2ChatExcerpt(workspaceId, chatId)).resolves.toEqual({
      title: "Auth notes",
      text: "User: How does @login.ts work?\nAssistant: Through OAuth.",
    });
    expect(database.queries).toHaveLength(1);
    const [query] = database.queries;
    expect(query!.text).toMatch(
      /"gen2_chats"\."id" = \$1 and "gen2_chats"\."workspace_id" = \$2/,
    );
    expect(query!.text).toMatch(
      /order by "gen2_chat_messages"\."created_at" desc limit \$3/,
    );
    expect(query!.values).toEqual([chatId, workspaceId, 12]);
  });

  it("returns nothing for a chat outside the workspace", async () => {
    await expect(readGen2ChatExcerpt(workspaceId, chatId)).resolves.toBeNull();
  });

  it("keeps the title of a chat with no messages yet", async () => {
    database.rows = [["Empty chat", null, null]];
    await expect(readGen2ChatExcerpt(workspaceId, chatId)).resolves.toEqual({
      title: "Empty chat",
      text: "",
    });
  });

  it("packs the newest messages last and marks what it left out", async () => {
    database.rows = Array.from({ length: 12 }, (_, index) => [
      "Long chat",
      index % 2 ? "user" : "assistant",
      `message ${11 - index} ${"x".repeat(400)}`,
    ]);
    const excerpt = await readGen2ChatExcerpt(workspaceId, chatId);
    const lines = excerpt!.text.split("\n");
    expect(excerpt!.text.length).toBeLessThanOrEqual(2_500);
    expect(lines[0]).toBe("[Older messages omitted.]");
    expect(lines.at(-1)).toMatch(/^Assistant: message 11 /);
    expect(excerpt!.text).not.toContain("message 0 ");
  });

  it("clips one long message and strips control characters", async () => {
    database.rows = [["Chat", "user", `start\u0007${"y".repeat(3_000)}`]];
    const excerpt = await readGen2ChatExcerpt(workspaceId, chatId);
    expect(excerpt!.text).toMatch(/^User: start y+\.\.\.$/);
    expect(excerpt!.text.length).toBeLessThan(1_300);
  });
});
