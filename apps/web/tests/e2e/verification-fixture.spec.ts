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
  await expect(
    page
      .getByRole("heading", { name: "Seeded files" })
      .locator("xpath=ancestor::section")
      .getByText("src/hello.ts", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No passwords, tokens, or provider credentials", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Viewer mutation controls are disabled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { name: "Viewer access check" })
      .locator("xpath=ancestor::section")
      .getByRole("button", { name: /Edit shared files/ }),
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
    page
      .getByRole("heading", { name: "Viewer access check" })
      .locator("xpath=ancestor::section")
      .getByRole("button", { name: /Edit shared files/ }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("heading", { name: "Viewer access check" })
      .locator("xpath=ancestor::section")
      .getByRole("button", { name: /Run terminal command/ }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("heading", { name: "Viewer access check" })
      .locator("xpath=ancestor::section")
      .getByRole("button", { name: /Manage members/ }),
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

test("F1.4 refreshes Jordan's Viewer controls after a live role change", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const roleCard = page
    .getByRole("heading", {
      name: "Manage member role",
    })
    .locator("xpath=ancestor::section");
  await expect(
    roleCard.getByText(
      "Jordan is connected as a Collaborator. Change the role to see the live refresh.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    roleCard.getByRole("button", { name: "Edit shared files · allowed" }),
  ).toBeEnabled();

  await roleCard
    .getByRole("combobox", { name: "Role for Jordan Lee" })
    .selectOption("viewer");

  await expect(roleCard.getByText("Membership refreshed live")).toBeVisible();
  await expect(
    roleCard.getByText(
      "Jordan’s Viewer controls updated immediately from the live membership change.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    roleCard.getByRole("button", { name: "Edit shared files · unavailable" }),
  ).toBeDisabled();

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F1.4",
    state: "member-role-viewer-live",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f1-4\/member-role-viewer-live\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();

  const edgeScreenshotPath = await captureVerificationScreenshot(
    page,
    testInfo,
    {
      taskId: "F1.4",
      state: "member-role-viewer-restricted",
    },
  );
  expect(edgeScreenshotPath).toMatch(
    /artifacts\/verification\/f1-4\/member-role-viewer-restricted\.png$/,
  );
  await expect.poll(() => access(edgeScreenshotPath)).toBeUndefined();
});

test("F2.1 shows two fixtures joined to one file with durable presence", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const presenceCard = page
    .getByRole("heading", {
      name: "Two fixtures, one file",
    })
    .locator("xpath=ancestor::section");
  await expect(presenceCard).toBeVisible();
  await presenceCard.getByRole("button", { name: "Join file" }).nth(0).click();
  await presenceCard.getByRole("button", { name: "Join file" }).nth(0).click();

  await expect(
    presenceCard.getByText(
      "Both fixtures are present in src/hello.ts with durable cursor state.",
    ),
  ).toBeVisible();
  await expect(presenceCard.getByLabel("Alex Morgan presence")).toContainText(
    "present in file",
  );
  await expect(presenceCard.getByLabel("Jordan Lee presence")).toContainText(
    "present in file",
  );
  await expect(presenceCard.getByLabel("Shared presence state")).toContainText(
    "src/hello.ts",
  );
  await expect(
    presenceCard.getByLabel("Durable presence events"),
  ).toContainText("6 events");

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F2.1",
    state: "two-fixtures-present",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f2-1\/two-fixtures-present\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();

  await presenceCard.getByRole("button", { name: "Leave file" }).nth(1).click();
  await expect(presenceCard.getByLabel("Jordan Lee presence")).toContainText(
    "not joined",
  );
  await expect(presenceCard.getByText("presence.left")).toBeVisible();

  const edgeScreenshotPath = await captureVerificationScreenshot(
    page,
    testInfo,
    { taskId: "F2.1", state: "fixture-left" },
  );
  expect(edgeScreenshotPath).toMatch(
    /artifacts\/verification\/f2-1\/fixture-left\.png$/,
  );
  await expect.poll(() => access(edgeScreenshotPath)).toBeUndefined();
});

test("F2.2 updates the other IDE view when Alex switches files", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const ideCard = page
    .getByRole("heading", { name: "Live shared IDE views" })
    .locator("xpath=ancestor::section");
  await expect(ideCard.getByLabel("Alex Morgan IDE presence")).toContainText(
    "present · editing",
  );
  await expect(ideCard.getByLabel("Jordan Lee IDE presence")).toContainText(
    "present · observing",
  );
  await expect(
    ideCard.getByLabel("Jordan Lee active-file observation"),
  ).toContainText("src/hello.ts");

  await ideCard
    .getByLabel("Alex Morgan file navigator")
    .getByRole("button", { name: "README.md" })
    .click();

  await expect(
    ideCard.getByLabel("Jordan Lee active-file observation"),
  ).toContainText("Alex Morgan is viewing README.md");
  await expect(ideCard.getByRole("status").last()).toContainText(
    "Jordan sees Alex Morgan viewing README.md.",
  );

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F2.2",
    state: "alex-switches-to-readme",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f2-2\/alex-switches-to-readme\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("F2.3 renders Alex's selection in Jordan's shared IDE view", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const ideCard = page
    .getByRole("heading", { name: "Live shared IDE views" })
    .locator("xpath=ancestor::section");
  await expect(ideCard.getByLabel("Jordan Lee remote selection")).toContainText(
    "No remote text selected",
  );

  await ideCard
    .getByRole("button", { name: "Select hello function as Alex" })
    .click();

  await expect(ideCard.getByLabel("Jordan Lee remote selection")).toContainText(
    "Alex Morgan selected hello function · lines 1–3",
  );
  await expect(ideCard.getByText("export function hello() {")).toHaveClass(
    /ideSelectedLine/,
  );
  await expect(ideCard.getByRole("status").last()).toContainText(
    "with the hello function selected",
  );

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F2.3",
    state: "alex-selects-hello-function",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f2-3\/alex-selects-hello-function\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();

  await ideCard.getByRole("button", { name: "README.md" }).click();
  await expect(ideCard.getByLabel("Jordan Lee remote selection")).toContainText(
    "No remote text selected",
  );

  const edgeScreenshotPath = await captureVerificationScreenshot(
    page,
    testInfo,
    { taskId: "F2.3", state: "selection-cleared-on-file-switch" },
  );
  expect(edgeScreenshotPath).toMatch(
    /artifacts\/verification\/f2-3\/selection-cleared-on-file-switch\.png$/,
  );
  await expect.poll(() => access(edgeScreenshotPath)).toBeUndefined();
});

test("F2.4 replays presence and document state after Jordan reconnects", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const ideCard = page
    .getByRole("heading", { name: "Live shared IDE views" })
    .locator("xpath=ancestor::section");
  await ideCard.getByRole("button", { name: "tests/hello.test.ts" }).click();
  await ideCard.getByRole("button", { name: "Disconnect Jordan" }).click();

  await expect(ideCard.getByLabel("Jordan Lee IDE presence")).toContainText(
    "offline · reconnecting",
  );
  await expect(
    ideCard.getByLabel("Jordan Lee active-file observation"),
  ).toContainText("tests/hello.test.ts");

  const edgeScreenshotPath = await captureVerificationScreenshot(
    page,
    testInfo,
    { taskId: "F2.4", state: "jordan-disconnected" },
  );
  expect(edgeScreenshotPath).toMatch(
    /artifacts\/verification\/f2-4\/jordan-disconnected\.png$/,
  );
  await expect.poll(() => access(edgeScreenshotPath)).toBeUndefined();

  await ideCard.getByRole("button", { name: "README.md" }).click();
  await expect(
    ideCard.getByLabel("Jordan Lee active-file observation"),
  ).toContainText("tests/hello.test.ts");

  await ideCard.getByRole("button", { name: "Reconnect Jordan" }).click();
  await expect(ideCard.getByLabel("Jordan Lee IDE presence")).toContainText(
    "present · observing",
  );
  await expect(
    ideCard.getByLabel("Jordan Lee active-file observation"),
  ).toContainText("Alex Morgan is viewing README.md");
  await expect(ideCard.getByLabel("Shared editor content")).toContainText(
    "# CoDev fixture",
  );
  await expect(ideCard.getByLabel("Jordan reconnect state")).toContainText(
    "Presence and document state replayed for README.md",
  );

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F2.4",
    state: "jordan-reconnected-document-replayed",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f2-4\/jordan-reconnected-document-replayed\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("F2.5 preserves both versions for an external file conflict", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const ideCard = page
    .getByRole("heading", { name: "Live shared IDE views" })
    .locator("xpath=ancestor::section");
  await ideCard
    .getByRole("button", { name: "Edit hello function as Alex" })
    .click();
  await ideCard
    .getByRole("button", { name: "Simulate terminal change" })
    .click();

  const conflict = ideCard.getByLabel("External file change conflict");
  await expect(conflict).toContainText("No version was overwritten.");
  await expect(
    conflict.getByLabel("Collaborative editor version"),
  ).toContainText('return "hello from Alex"');
  await expect(
    conflict.getByLabel("External filesystem version"),
  ).toContainText('return "hello from terminal"');
  await expect(
    conflict.getByLabel("Conflict resolution choices"),
  ).toContainText("Merge manually");
  await expect(ideCard.getByRole("status").last()).toContainText(
    "both versions remain available for review",
  );

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F2.5",
    state: "external-file-conflict-preserved",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f2-5\/external-file-conflict-preserved\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});

test("F3.1 opens an idle shared session with an empty ordered queue", async ({
  page,
}, testInfo) => {
  await page.goto("/verification/b0-2");

  const sessionCard = page
    .getByRole("heading", { name: "Shared session queue" })
    .locator("xpath=ancestor::section");
  await sessionCard
    .getByRole("button", { name: "Open shared session" })
    .click();

  await expect(sessionCard.getByLabel("Open shared session")).toBeVisible();
  await expect(sessionCard.getByLabel("Session metadata")).toContainText(
    "Codex-compatible",
  );
  await expect(sessionCard.getByLabel("Session metadata")).toContainText(
    "Idle · awaiting instruction",
  );
  await expect(sessionCard.getByLabel("Ordered turn queue")).toContainText(
    "0 queued",
  );
  await expect(
    sessionCard.getByText("Queue is empty — no instructions are waiting."),
  ).toBeVisible();
  await expect(sessionCard.getByRole("status")).toContainText(
    "Shared session is open and idle with an empty ordered queue.",
  );

  const screenshotPath = await captureVerificationScreenshot(page, testInfo, {
    taskId: "F3.1",
    state: "shared-session-idle-queue",
  });
  expect(screenshotPath).toMatch(
    /artifacts\/verification\/f3-1\/shared-session-idle-queue\.png$/,
  );
  await expect.poll(() => access(screenshotPath)).toBeUndefined();
});
