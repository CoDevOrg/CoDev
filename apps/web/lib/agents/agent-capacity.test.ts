import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  managedAgentSessionPredicate,
  managedLiveAgentWorktreePredicate,
} from "./agent-capacity";

const dialect = new PgDialect();

describe("managed agent capacity predicates", () => {
  it("restricts the session population to managed workspace sessions", () => {
    const query = dialect.sqlToQuery(
      managedAgentSessionPredicate("workspace-1"),
    );

    expect(query.sql).toContain('"agent_sessions"."workspace_id" = $1');
    expect(query.sql).toContain('"agent_sessions"."kind" = $2');
    expect(query.params).toEqual(["workspace-1", "managed"]);
  });

  it("restricts capacity to active or frozen managed worktrees", () => {
    const query = dialect.sqlToQuery(
      managedLiveAgentWorktreePredicate("workspace-1"),
    );

    expect(query.sql).toContain('"agent_sessions"."kind" = $2');
    expect(query.sql).toContain('"worktrees"."status" in ($3, $4)');
    expect(query.params).toEqual([
      "workspace-1",
      "managed",
      "active",
      "frozen",
    ]);
  });
});
