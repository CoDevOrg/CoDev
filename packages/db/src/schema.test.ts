import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  agentSessions,
  coordinationMessages,
  pathClaims,
  workspaceMembers,
  workspaces,
  yjsSnapshots,
} from "./schema";

describe("database schema", () => {
  it("defines the core workspace tables", () => {
    expect(getTableName(workspaces)).toBe("workspaces");
    expect(getTableName(workspaceMembers)).toBe("workspace_members");
    expect(getTableName(agentSessions)).toBe("agent_sessions");
    expect(getTableName(pathClaims)).toBe("path_claims");
    expect(getTableName(coordinationMessages)).toBe("coordination_messages");
    expect(getTableName(yjsSnapshots)).toBe("yjs_snapshots");
    expect(yjsSnapshots.stateVector.name).toBe("state_vector_base64");
    expect(yjsSnapshots.filesystemContents.name).toBe("filesystem_contents");
    expect(yjsSnapshots.hasConflict.name).toBe("has_conflict");
  });
});
