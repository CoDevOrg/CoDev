import { expect, test } from "@playwright/test";
import { captureVerificationScreenshot } from "./support/evidence";

for (const colorScheme of ["light", "dark"] as const) {
  test(`owned IDE preserves the pending workspace shell in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript((theme) => {
      localStorage.setItem("orca.web.settings.v1", JSON.stringify({ theme }));
    }, colorScheme);
    await page.goto(
      "/orca/web-index.html#codev=1&codevPending=1&codevProjectKind=folder",
    );
    await expect(
      page.getByRole("button", { name: "Toggle sidebar", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`\\b${colorScheme}\\b`),
    );
    await expect(page.locator('script[src*="codev-preload.js"]')).toHaveCount(
      0,
    );
    const integration = await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "api");
      return {
        intercepted: Boolean(descriptor?.get || descriptor?.set),
        mobileDefault: JSON.parse(
          localStorage.getItem("orca.web.settings.v1") ?? "{}",
        ).showMobileButton,
        agentsDefault: JSON.parse(
          localStorage.getItem("orca.web.ui.v1") ?? "{}",
        ).codevLiveAgentsDefaultApplied,
      };
    });
    expect(integration).toEqual({
      intercepted: false,
      mobileDefault: false,
      agentsDefault: true,
    });
    const sidebar = page.getByRole("button", {
      name: "Toggle sidebar",
      exact: true,
    });
    await sidebar.focus();
    await expect(sidebar).toBeFocused();
    await captureVerificationScreenshot(page, testInfo, {
      taskId: "workspace-consolidation",
      state: `${colorScheme}-pending-shell`,
    });
  });
}
