import { describe, expect, it } from "vitest";

import { filterSupersetAgentOutput } from "./superset-agent-output";

describe("Superset agent progress output", () => {
  it("removes private profile paths and credentials before persistence", () => {
    const output = filterSupersetAgentOutput(
      "\u001b[2J. /var/lib/codev-agent-profiles/agent-a/launch.sh\nOPENAI_API_KEY=sk-secret\nBearer token-value\nDone",
    );

    expect(output).toContain("[private agent data removed]");
    expect(output).toContain("[redacted]");
    expect(output).toContain("Done");
    expect(output).not.toContain("codev-agent-profiles");
    expect(output).not.toContain("sk-secret");
  });
});
