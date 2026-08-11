import { access } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { captureVerificationScreenshot } from "./support/evidence";

test("B0.3 captures the fixture ready state as reusable evidence", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  await expect(
    page.getByRole("heading", { name: "CoDev Fixture Workspace" }),
  ).toBeVisible();
  await expect(
    page.getByText("Ready for browser verification", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Alex Morgan", { exact: true })).toBeVisible();
  await expect(page.getByText("Jordan Lee", { exact: true })).toBeVisible();
  await expect(page.getByText("src/hello.ts", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No passwords, tokens, or provider credentials", {
      exact: false,
    }),
  ).toBeVisible();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "B0.3",
    state: "fixture-ready",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/b0-3\/fixture-ready\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});
