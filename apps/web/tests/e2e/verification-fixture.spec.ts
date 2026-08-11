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
  const memberCard = page
    .getByRole("heading", { name: "Ready-to-use members" })
    .locator("xpath=ancestor::section");
  await expect(
    memberCard.getByText("Alex Morgan", { exact: true }),
  ).toBeVisible();
  await expect(
    memberCard.getByText("Jordan Lee", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Casey Rivera", { exact: true })).toBeVisible();
  await expect(page.getByText("src/hello.ts", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No passwords, tokens, or provider credentials", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Viewer mutation controls are disabled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Edit shared files/ }),
  ).toBeDisabled();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "B0.3",
    state: "fixture-ready",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/b0-3\/fixture-ready\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("B0.4 shows the reconciled three-agent worktree capacity", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  await expect(page.getByLabel("Agent worktree capacity")).toContainText(
    "3 slots available",
  );

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "B0.4",
    state: "agent-capacity",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/b0-4\/agent-capacity\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("F1.1 captures the Viewer restriction state", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  await expect(
    page.getByRole("heading", { name: "Viewer access check" }),
  ).toBeVisible();
  await expect(
    page.getByText("Viewer mutation controls are disabled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Edit shared files/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Run terminal command/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Manage members/ }),
  ).toBeDisabled();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F1.1",
    state: "viewer-restrictions",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f1-1\/viewer-restrictions\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("F1.2 creates and accepts a single-use invite", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  await expect(
    page.getByRole("heading", { name: "Invite and accept once" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create invite" }),
  ).toBeEnabled();
  await expect(page.getByText(/waiting for invite/)).toBeVisible();

  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(
    page.getByText("Expires in 24 hours · single use"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept as Jordan" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Accept as Jordan" }).click();
  await expect(page.getByText(/joined via invite/)).toBeVisible();
  await expect(
    page
      .locator("section[aria-labelledby='invite-heading']")
      .getByRole("status"),
  ).toContainText("accepted once and cannot be reused");
  await expect(
    page.getByRole("button", { name: "Invite already used" }),
  ).toBeDisabled();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F1.2",
    state: "invite-accepted",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f1-2\/invite-accepted\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();

  const edgeScreenshotPath = await captureVerificationScreenshot(
    page,
    testInfo,
    {
      taskId: "F1.2",
      state: "invite-used-edge",
    },
  );
  expect(edgeScreenshotPath).toMatch(
    /artifacts\/verification\/f1-2\/invite-used-edge\.png$/,
  );
  await expect.poll(() => access(edgeScreenshotPath)).toBeUndefined();
});

test("F1.3 blocks a revoked invite from being accepted", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  await page.getByRole("button", { name: "Create invite" }).click();
  await page.getByRole("button", { name: "Revoke invite" }).click();
  await expect(
    page.getByText("Invite revoked. Jordan can no longer use this link."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept as Jordan" }).click();

  await expect(
    page.getByText(
      "Jordan cannot join: Alex revoked this invite before acceptance.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join rejected" }),
  ).toBeDisabled();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F1.3",
    state: "invite-revoked-edge",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f1-3\/invite-revoked-edge\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("F1.3 blocks an expired invite from being accepted", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  await page.getByRole("button", { name: "Create invite" }).click();
  await page.getByRole("button", { name: "Simulate expiry" }).click();
  await page.getByRole("button", { name: "Accept as Jordan" }).click();

  await expect(
    page.getByText(
      "Jordan cannot join: this invite expired before acceptance.",
    ),
  ).toBeVisible();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F1.3",
    state: "invite-expired-edge",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f1-3\/invite-expired-edge\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});
