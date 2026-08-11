import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";

type VerificationScreenshot = {
  taskId: string;
  state: string;
};

function safeSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "evidence"
  );
}

export async function captureVerificationScreenshot(
  page: Page,
  testInfo: TestInfo,
  { taskId, state }: VerificationScreenshot,
) {
  const safeTaskId = safeSegment(taskId);
  const safeState = safeSegment(state);
  const directory = path.resolve(
    testInfo.config.rootDir,
    "../../../../artifacts/verification",
    safeTaskId,
  );
  const screenshotPath = path.join(directory, `${safeState}.png`);

  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`${safeTaskId}-${safeState}`, {
    path: screenshotPath,
    contentType: "image/png",
  });

  return screenshotPath;
}
