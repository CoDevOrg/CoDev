import { afterEach, expect, it, vi } from "vitest";

const quiesce = vi.hoisted(() => vi.fn(async () => ({ stopped: 2 })));
vi.mock("@/lib/gen2/superset-agent-runtime", () => ({
  quiesceGen2SupersetWorkspace: quiesce,
}));

import { POST } from "./route";

afterEach(() => {
  delete process.env.CODEV_CONTROL_PLANE_SECRET;
  quiesce.mockClear();
});

it("accepts only the runtime callback secret before quiescing a workspace", async () => {
  process.env.CODEV_CONTROL_PLANE_SECRET = "c".repeat(32);
  const context = { params: Promise.resolve({ workspaceId: "workspace-1" }) };
  expect((await POST(new Request("http://localhost"), context)).status).toBe(
    401,
  );
  expect(
    (
      await POST(
        new Request("http://localhost", {
          headers: { authorization: "Bearer wrong" },
        }),
        context,
      )
    ).status,
  ).toBe(401);
  const response = await POST(
    new Request("http://localhost", {
      headers: { authorization: `Bearer ${"c".repeat(32)}` },
    }),
    context,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ stopped: 2 });
  expect(quiesce).toHaveBeenCalledWith("workspace-1");
});
