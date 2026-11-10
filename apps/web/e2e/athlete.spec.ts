import { expect, test } from "@playwright/test";
import { db, signIn } from "./helpers";

test("a new athlete signs up, signs the waiver, and is told plainly when payments are off", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.furyco.test`;
  await page.goto("/");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Erin Endtoend");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("FuryDemo123!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Erin Endtoend" })).toBeVisible();
  await expect(page.getByText("Sign the agreement above to buy a membership.")).toBeVisible();

  await page.getByLabel("I have read and agree to the above.").check();
  await page.getByLabel("Type your full legal name to sign").fill("Erin Endtoend");
  await page.getByRole("button", { name: "Sign agreement" }).click();
  await expect(page.getByText("Please sign:")).toHaveCount(0);

  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { data: signature } = await db().from("waiver_signatures").select("signed_name, user_agent").eq("user_id", profile!.id).single();
  expect(signature!.signed_name).toBe("Erin Endtoend");
  expect(signature!.user_agent).toBeTruthy();

  // No Stripe keys in the test environment: buying explains itself instead of failing silently.
  await page.getByRole("button", { name: /\$185\.00 \/ month/ }).click();
  await expect(page.getByText("Online payment is not switched on yet")).toBeVisible();
  const { count } = await db().from("memberships").select("id", { count: "exact", head: true }).eq("user_id", profile!.id);
  expect(count).toBe(0);
});

test("athletes are kept out of the staff console", async ({ page }) => {
  await signIn(page, "alex@furyco.test");
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/admin/members");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Selection Prep — 6 Week").first()).toBeVisible();
  await expect(page.getByText("Unlimited Monthly").first()).toBeVisible();
});

test("signed-out visitors are sent to sign in, and can browse programs", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.goto("/programs/selection-prep-6");
  await expect(page.getByRole("heading", { name: "Selection Prep — 6 Week" })).toBeVisible();
  await expect(page.getByText("$149.00")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" })).toBeVisible();
});
