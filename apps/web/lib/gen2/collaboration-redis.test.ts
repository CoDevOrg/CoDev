import { expect, test, vi } from "vitest";

const randomUUID = vi.hoisted(() => vi.fn(() => "worker-instance"));

vi.mock("node:crypto", () => ({ randomUUID }));

import { getInstanceId } from "./collaboration-redis";

test("creates the collaboration instance ID only after a request needs it", () => {
  expect(randomUUID).not.toHaveBeenCalled();
  expect(getInstanceId()).toBe("worker-instance");
  expect(getInstanceId()).toBe("worker-instance");
  expect(randomUUID).toHaveBeenCalledTimes(1);
});
