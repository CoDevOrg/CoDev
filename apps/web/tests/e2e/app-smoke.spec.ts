import { expect, test } from "@playwright/test";

test("the public landing page explains CoDev", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Ship it together/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Pricing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Get early access" }).first(),
  ).toBeVisible();
});

test("the sign-in page offers the email sign-in flow", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(
    page.getByRole("heading", { name: "Welcome to CoDev." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with email" }),
  ).toBeVisible();
});
