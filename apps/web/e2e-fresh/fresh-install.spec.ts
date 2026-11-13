import { expect, test, type Page } from "@playwright/test";
import { addDays, asUser, db } from "../e2e/helpers";

// Runs against a database with migrations only and no seed data, which is what production
// starts from. It follows docs/launch-checklist.md: first owner, waiver, plan, class, workout,
// display, then a new athlete joining.

const PASSWORD = "FuryDemo123!";
const OWNER = "first-owner@test.furyco.test";
const ATHLETE = "first-athlete@test.furyco.test";

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/join");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test("a new gym can be set up from an empty database", async ({ page, browser, request }) => {
  const admin = db();
  const serverErrors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
  });

  // --- the database really is unseeded, and the app is healthy on it ---------------------------
  const { count: seededPlans } = await admin.from("membership_plans").select("id", { count: "exact", head: true });
  expect(seededPlans, "run `pnpm exec supabase db reset --no-seed` before this suite").toBe(0);
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", database: "ok" });

  // --- the first account is an athlete until promoted, as the launch checklist describes --------
  await signUp(page, "Fiona Firstowner", OWNER);
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
  const { data: profile } = await admin.from("profiles").select("id").eq("email", OWNER).single();
  const { error: promoteError } = await admin.from("gym_members").update({ role: "owner" }).eq("user_id", profile!.id);
  expect(promoteError).toBeNull();

  // --- every console page opens on an empty gym ---------------------------------------------------
  for (const path of ["", "/members", "/memberships", "/plans", "/programming", "/programs", "/schedule", "/exercises", "/checkin", "/display", "/reports", "/activity"]) {
    const response = await page.goto(`/admin${path}`);
    expect(response!.status(), `/admin${path}`).toBe(200);
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
  await page.goto("/admin/members");
  await expect(page.getByText("1 person at Fury Co. Athletics")).toBeVisible();

  // --- waiver and first plan ----------------------------------------------------------------------
  await page.goto("/admin/plans", { waitUntil: "networkidle" });
  await expect(page.getByText("No waiver is published.")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByLabel("Agreement text").fill("I understand that training carries a risk of injury and I take part at my own risk.");
  await page.getByRole("button", { name: "Publish new version" }).click();
  await expect(page.getByText(/version 1, published/)).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Unlimited Monthly");
  await page.getByLabel("Price (USD)").fill("150");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByText("No plans yet.")).toHaveCount(0);
  const { data: plan } = await admin.from("membership_plans").select("id, price_cents, kind, active").eq("name", "Unlimited Monthly").single();
  expect(plan).toMatchObject({ price_cents: 15000, kind: "recurring", active: true });

  // --- exercise, class and a published workout ------------------------------------------------------
  await page.goto("/admin/exercises", { waitUntil: "networkidle" });
  const exerciseForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add exercise", exact: true }) });
  await exerciseForm.getByLabel("Name").fill("Back Squat");
  await exerciseForm.getByRole("button", { name: "Add exercise", exact: true }).click();
  await expect(page.getByText("1 exercise", { exact: false }).first()).toBeVisible();

  const { data: gym } = await admin.from("gyms").select("id").eq("is_default", true).single();
  const { data: today } = await admin.rpc("gym_today", { p_gym: gym!.id });
  await page.goto("/admin/schedule", { waitUntil: "networkidle" });
  const classForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add class", exact: true }) });
  await classForm.getByLabel("Title").fill("Opening Day");
  await classForm.getByLabel("Date").fill(addDays(today as string, 1));
  await classForm.getByLabel("Start time").fill("12:00");
  await classForm.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(page.getByText("Opening Day").first()).toBeVisible();

  await page.goto(`/admin/programming/workouts/new?date=${today}`, { waitUntil: "networkidle" });
  await page.getByLabel("Title").first().fill("First Session");
  await page.getByLabel("Track").selectOption({ label: "Strength" });
  await page.getByLabel("Search exercises").fill("squat");
  await page.getByRole("button", { name: /Back Squat/ }).click();
  await page.getByTestId("workout-item").first().getByLabel("Prescription").fill("5 x 5");
  await page.getByText("Publish now").click();
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page).toHaveURL(/\/admin\/programming\?week=/);

  // --- the display link made by the migrations shows it without a login ---------------------------
  await page.goto("/admin/display");
  const link = (await page.getByText(/\/display\/[0-9a-f]{20,}/).first().innerText()).trim();
  const tv = await browser.newContext();
  const screen = await tv.newPage();
  await screen.goto(new URL(link).pathname);
  await expect(screen.getByRole("heading", { name: "First Session" })).toBeVisible();
  await expect(screen.getByText("5 x 5")).toBeVisible();
  await tv.close();

  // --- a new athlete joins, signs, and gets a membership by hand ------------------------------------
  const visitor = await browser.newContext();
  const athletePage = await visitor.newPage();
  await signUp(athletePage, "Andy Firstathlete", ATHLETE);
  await expect(athletePage.getByText("Please sign:")).toBeVisible();
  await athletePage.getByLabel("I have read and agree to the above.").check();
  await athletePage.getByLabel("Type your full legal name to sign").fill("Andy Firstathlete");
  await athletePage.getByRole("button", { name: "Sign agreement" }).click();
  await expect(athletePage.getByText("Please sign:")).toHaveCount(0);
  await expect(athletePage.getByText("Unlimited Monthly").first()).toBeVisible();
  await athletePage.goto("/admin");
  await expect(athletePage).not.toHaveURL(/\/admin/);

  const { data: athlete } = await admin.from("profiles").select("id").eq("email", ATHLETE).single();
  await page.goto(`/admin/members/${athlete!.id}`, { waitUntil: "networkidle" });
  await page.getByLabel("Add a membership without payment").selectOption(plan!.id);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(async () => (await admin.from("memberships").select("status").eq("user_id", athlete!.id)).data?.[0]?.status).toBe("active");

  // --- the athlete sees the membership and can book the class (what the iOS app calls) --------------
  await athletePage.reload();
  await expect(athletePage.getByText("You do not have a membership yet.")).toHaveCount(0);
  await visitor.close();
  const { data: session } = await admin.from("class_sessions").select("id").eq("title", "Opening Day").single();
  const booking = await (await asUser(ATHLETE)).rpc("book_class", { p_session: session!.id });
  expect(booking.error).toBeNull();
  const { data: booked } = await admin.from("bookings").select("status").eq("session_id", session!.id).eq("user_id", athlete!.id).single();
  expect(booked!.status).toBe("booked");

  // --- the change log recorded the setup, and nothing 500'd -----------------------------------------
  await page.goto("/admin/activity");
  await expect(page.getByRole("row").filter({ hasText: "Unlimited Monthly" }).first()).toBeVisible();
  expect(serverErrors).toEqual([]);
});
