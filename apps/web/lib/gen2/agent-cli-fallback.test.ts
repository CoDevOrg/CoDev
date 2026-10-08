import { beforeEach, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  value: [] as Array<Record<string, unknown>>,
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({ from: () => ({ where: async () => rows.value }) }),
  }),
}));

import {
  avoidBlockedCliModel,
  cliModelRequirement,
  cliUpdateRequirements,
  cliUpdateRequirementsForService,
  closestFallbackModel,
  fallbackNote,
} from "./agent-cli-fallback";

// The exact failure a workspace showed on 2026-10-08.
const SEEN =
  "API Error: 400 Claude Code 2.1.236 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.";
const models = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-opus-5-1", label: "Opus 5.1" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];

beforeEach(() => {
  rows.value = [];
  vi.unstubAllEnvs();
});

it("recognizes Claude Code's too-old error and nothing else", () => {
  expect(cliModelRequirement("claude", SEEN)).toEqual({
    observedVersion: "2.1.236",
    minVersion: "2.1.280",
  });
  expect(cliModelRequirement("claude", "API Error: 529 overloaded")).toBeNull();
  expect(cliModelRequirement("codex", SEEN)).toBeNull();
  expect(cliModelRequirement("claude", null)).toBeNull();
});

it("falls back to the closest model in the same family, skipping blocked ones", () => {
  expect(closestFallbackModel("claude-opus-5-5", models, new Set())).toBe(
    "claude-opus-5-1",
  );
  expect(
    closestFallbackModel(
      "claude-opus-5-5",
      models,
      new Set(["claude-opus-5-1"]),
    ),
  ).toBe("claude-sonnet-5-5");
  expect(
    closestFallbackModel("claude-opus-5-5", models.slice(0, 1), new Set()),
  ).toBeNull();
});

it("says which model answered and why, or that none can yet", () => {
  const requirement = { observedVersion: "2.1.236", minVersion: "2.1.280" };
  expect(
    fallbackNote({
      provider: "claude",
      from: "claude-opus-5-5",
      to: "claude-opus-5-1",
      requirement,
    }),
  ).toBe(
    "claude-opus-5-5 needs Claude Code 2.1.280 or newer, and this workspace has 2.1.236. Workspaces are being updated now. Answering with claude-opus-5-1 in the meantime.",
  );
  expect(
    fallbackNote({
      provider: "claude",
      from: "claude-opus-5-5",
      to: null,
      requirement,
    }),
  ).toMatch(/No other model on your account can run here yet/);
});

it("swaps a known-blocked model for its fallback before a turn starts", async () => {
  rows.value = [
    {
      provider: "claude",
      model: "claude-opus-5-5",
      minVersion: "2.1.280",
      observedVersion: "2.1.236",
    },
  ];
  expect(
    await avoidBlockedCliModel("claude", "claude-opus-5-5", models),
  ).toMatchObject({
    model: "claude-opus-5-1",
    note: expect.stringContaining("2.1.280"),
  });
  expect(
    await avoidBlockedCliModel("claude", "claude-sonnet-5-5", models),
  ).toEqual({ model: "claude-sonnet-5-5", note: null });
});

it("asks the updater for the highest minimum each CLI needs", async () => {
  rows.value = [
    {
      provider: "claude",
      model: "a",
      minVersion: "2.1.280",
      observedVersion: "2.1.236",
    },
    {
      provider: "claude",
      model: "b",
      minVersion: "2.1.291",
      observedVersion: "2.1.236",
    },
    {
      provider: "codex",
      model: "c",
      minVersion: "0.170.0",
      observedVersion: "0.148.0",
    },
  ];
  expect(await cliUpdateRequirements()).toEqual(["claude-code=2.1.291"]);
});

it("serves requirements only with the service secret", async () => {
  vi.stubEnv("CRON_SECRET", "service-secret");
  const call = (authorization?: string) =>
    cliUpdateRequirementsForService(
      new Request("https://trycodev.com/api/gen2/agent-cli-requirements", {
        headers: authorization ? { authorization } : {},
      }),
    );
  await expect(call()).rejects.toMatchObject({ status: 401 });
  await expect(call("Bearer wrong")).rejects.toMatchObject({ status: 401 });
  await expect(call("Bearer service-secret")).resolves.toEqual({
    requirements: [],
  });
});
