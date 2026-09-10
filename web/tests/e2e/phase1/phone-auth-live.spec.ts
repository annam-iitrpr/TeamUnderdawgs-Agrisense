import { expect, test } from "@playwright/test";

/**
 * Live Firebase Phone Auth coverage. Firebase fictional numbers do not send an
 * SMS, but they mint a real Firebase ID token and therefore exercise the API
 * enrollment path. The test is opt-in so ordinary layout CI never needs a
 * phone number or verification code.
 */
const phone = process.env.FIREBASE_TEST_PHONE;
const code = process.env.FIREBASE_TEST_CODE;

test("fictional Firebase phone user reaches the authenticated dashboard", async ({ page }) => {
  test.skip(!phone || !code, "Set FIREBASE_TEST_PHONE and FIREBASE_TEST_CODE for live auth E2E.");

  await page.goto("/sign-in");
  await page.getByLabel(/phone number/i).fill(phone!);
  await page.getByRole("button", { name: /send code/i }).click();
  await page.getByLabel(/verification code/i).fill(code!);
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText(/fields|set up your first field/i).first()).toBeVisible();
});
