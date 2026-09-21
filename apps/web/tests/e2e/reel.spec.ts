import { expect, test } from "@playwright/test";

test("the local reel demo fills the recording viewport in every scene", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const scene of [
    "share",
    "presence",
    "chat",
    "agents",
    "conflict",
    "review",
  ]) {
    await page.goto(`/demo/reel?autoplay=0&controls=1&scene=${scene}`);
    await expect(
      page.getByLabel("Synthetic CoDev collaboration demo"),
    ).toBeVisible();
    await expect(page.getByLabel("Demo scene")).toHaveValue(scene);
  }

  await expect(page.getByText("42 tests passed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Merged into main/ }),
  ).toBeVisible();

  const reelBounds = await page
    .getByLabel("Synthetic CoDev collaboration demo")
    .boundingBox();
  expect(reelBounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });

  const overflow = await page.evaluate(() => ({
    x:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    y:
      document.documentElement.scrollHeight >
      document.documentElement.clientHeight,
  }));
  expect(overflow).toEqual({ x: false, y: false });
  expect(consoleErrors).toEqual([]);
});
