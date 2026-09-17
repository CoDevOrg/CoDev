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

test("pending workspaces open on the branches surface, not the terminal", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/orca/web-index.html#codev=1&codevPending=1&codevProjectKind=folder",
  );

  const branches = page.locator('[data-codev-branches="true"]');
  await expect(branches).toBeVisible({ timeout: 20_000 });
  await expect(
    branches.getByRole("heading", { name: "Branches", exact: true }),
  ).toBeVisible();
  await expect(
    branches.getByText(
      "Every active branch has one shared place for code, chat, agents, and changes.",
    ),
  ).toBeVisible();
  await expect(
    branches.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeVisible();

  // The branch overview owns the first surface. The persistent branch header
  // and terminal disclosure only exist after a branch is selected.
  await expect(
    page.getByRole("button", { name: "Terminal", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-codev-chat-first="true"]')).toHaveCount(0);

  await expect(
    branches.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeDisabled();
  const focusTarget = branches.locator("button:not([disabled])").first();
  await expect(focusTarget).toBeVisible();
  await focusTarget.focus();
  await expect(focusTarget).toBeFocused();
});

test("direct branch routes survive web-client bootstrap", async ({ page }) => {
  await page.goto(
    "/orca/web-index.html#codev=1&codevPending=1&codevProjectKind=folder&codevBranch=feature%2Fchat-first",
  );

  await expect
    .poll(() => page.evaluate(() => window.__CODEV_BRANCH__))
    .toBe("feature/chat-first");
});
