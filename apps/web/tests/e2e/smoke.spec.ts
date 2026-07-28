import { expect, test } from "@playwright/test";

test("landing page presents CoDev as a hosted browser workspace", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: /One workspace. Two kinds of builders./,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/browser-based engineering workspace/),
  ).toBeVisible();
  await expect(page.getByText(/No download. No local app./)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("fixture workspace renders and exposes honest connection states", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/workspaces/demo");

  await expect(page.getByText("Demo shell", { exact: true })).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Terminal unavailable in demo shell"),
  ).toBeVisible();
  await expect(page.getByLabel("Fixture TypeScript source")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("health endpoint reports the web service", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "codev-web",
  });
});

test("database health endpoint reaches Supabase", async ({ request }) => {
  test.skip(
    process.env.PLAYWRIGHT_DATABASE_HEALTH !== "true",
    "Only run when a Supabase environment is connected.",
  );

  const response = await request.get("/api/health/database");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "codev-database",
  });
});
