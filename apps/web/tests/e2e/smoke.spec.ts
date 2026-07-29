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

test("protected workspace routes require GitHub identity", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole("heading", { name: "Open your CoDev workspace." }),
  ).toBeVisible();
});

test("workspace APIs reject anonymous requests", async ({ request }) => {
  const response = await request.post("/api/workspaces", {
    data: { installationId: 1, repositoryId: 1 },
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({
    error: "Authentication required.",
  });

  const files = await request.get(
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/sandbox/files",
  );
  expect(files.status()).toBe(401);
  await expect(files.json()).resolves.toEqual({
    error: "Authentication required.",
  });

  const agents = await request.get(
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents",
  );
  expect(agents.status()).toBe(401);
  await expect(agents.json()).resolves.toEqual({
    error: "Authentication required.",
  });

  for (const endpoint of [
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/review",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/merge",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/discard",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/claims",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/messages",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/collaboration/conflicts/resolve",
  ]) {
    const protectedResponse = await request.post(endpoint, { data: {} });
    expect(protectedResponse.status()).toBe(401);
    await expect(protectedResponse.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  }
});
