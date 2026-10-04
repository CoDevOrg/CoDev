import { afterEach, expect, it, vi } from "vitest";

const monitor = vi.hoisted(() =>
  vi.fn(async () => ({ checked: 1, running: 1, recoveryRequired: 0 })),
);
vi.mock("@/lib/gen2/superset-agent-runtime", () => ({
  monitorGen2SupersetAgentSessions: monitor,
}));

import { GET } from "./route";

afterEach(() => {
  delete process.env.CRON_SECRET;
  monitor.mockClear();
});

it("requires the scheduler secret before monitoring Superset agents", async () => {
  process.env.CRON_SECRET = "scheduler-secret";
  expect(
    (await GET(new Request("http://localhost/api/gen2/agents/monitor"))).status,
  ).toBe(401);
  const response = await GET(
    new Request("http://localhost/api/gen2/agents/monitor", {
      headers: { authorization: "Bearer scheduler-secret" },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    checked: 1,
    running: 1,
    recoveryRequired: 0,
  });
});
