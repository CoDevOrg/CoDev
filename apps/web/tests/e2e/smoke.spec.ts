import { expect, test } from "@playwright/test";

test("landing page explains CoDev and offers a clear start", async ({
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
      name: /Use AI.*together/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /turns your AI session into a room you can share with a link/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Three things/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Request access/ }).first(),
  ).toHaveAttribute("href", "/sign-in");
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
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome to CoDev." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Forgot password?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
});

test("workspace APIs reject anonymous requests", async ({ request }) => {
  const response = await request.post("/api/workspaces", {
    data: { installationId: 1, repositoryId: 1 },
  });

  if (response.status() === 503) {
    await expect(response.json()).resolves.toEqual({
      error: "Rate limiting is temporarily unavailable.",
    });
  } else {
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  }

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

  const protectedStreamingEndpoints = [
    {
      method: "post" as const,
      endpoint:
        "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/stream",
      data: { prompt: "anonymous requests must be rejected" },
    },
    {
      method: "get" as const,
      endpoint:
        "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/collaboration/hocuspocus-token",
    },
    {
      method: "get" as const,
      endpoint:
        "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/sandbox/terminal/stream",
    },
  ];
  for (const { method, endpoint, data } of protectedStreamingEndpoints) {
    const response = await request[method](endpoint, data ? { data } : {});
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  }

  for (const endpoint of [
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/publications",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/events",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/claims",
  ]) {
    const response = await request.get(endpoint);
    expect(response.status()).toBe(401);
  }

  const lifecycle = await request.get("/api/cron/lifecycle");
  expect(lifecycle.status()).toBe(401);

  const protectedFeedback = await request.post("/api/feedback", {
    data: {
      category: "workflow",
      rating: 5,
      message: "Anonymous feedback must not be accepted.",
      page: "/",
      workspaceId: null,
    },
  });
  expect(protectedFeedback.status()).toBe(401);

  for (const endpoint of [
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/review",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/merge",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/discard",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/aa22f527-8992-4814-95a2-070f1b01fc9f/claims",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/claims",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/claims/reassign",
    "/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/agents/claims/cancel",
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
