import { randomUUID } from "node:crypto";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { addDays, db, gymToday, PASSWORD, signIn } from "./helpers";

test.beforeAll(() => {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost").hostname;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(host);
});

async function newProgram() {
  const { data: gym } = await db().from("gyms").select("id").eq("is_default", true).single().throwOnError();
  const { data } = await db().from("programs").insert({
    gym_id: gym!.id, name: `Form regression ${randomUUID()}`, slug: `form-${randomUUID()}`,
    duration_weeks: 4, days_per_week: 3, price_cents: 1000,
  }).select().single().throwOnError();
  return data!;
}

async function submit(page: Page, button: Locator) {
  const response = page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));
  await button.click();
  await response;
  await expect(button).toBeEnabled();
}

test("invalid program settings preserve edits until a corrected save", async ({ page }) => {
  const program = await newProgram();
  try {
    await signIn(page, "owner@furyco.test");
    await page.goto(`/admin/programs/${program.id}`);
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save settings" }) });
    await form.getByLabel("Name", { exact: true }).fill("Revised program name");
    await form.getByLabel("Description", { exact: true }).fill("Keep my unsaved description");
    await form.getByLabel("Workouts unlock").selectOption("daily");
    await form.getByLabel("Price (USD)").fill("not a price");
    await submit(page, form.getByRole("button", { name: "Save settings" }));
    await expect(form.getByRole("alert")).toContainText("Enter a price");
    await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Revised program name");
    await expect(form.getByLabel("Description", { exact: true })).toHaveValue("Keep my unsaved description");
    await expect(form.getByLabel("Workouts unlock")).toHaveValue("daily");
    await expect(form.getByLabel("Price (USD)")).toHaveValue("not a price");
    const before = await db().from("programs").select("name").eq("id", program.id).single().throwOnError();
    expect(before.data!.name).toBe(program.name);

    await form.getByLabel("Price (USD)").fill("25.50");
    await submit(page, form.getByRole("button", { name: "Save settings" }));
    await expect(form.getByRole("status")).toContainText("Program saved");
    await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Revised program name");
    const after = await db().from("programs").select("name,description,price_cents,unlock_mode").eq("id", program.id).single().throwOnError();
    expect(after.data).toEqual({ name: "Revised program name", description: "Keep my unsaved description", price_cents: 2550, unlock_mode: "daily" });
  } finally {
    await db().from("programs").delete().eq("id", program.id).throwOnError();
  }
});

test("unchanged enrollment saves preserve status and server-adjusted expiry", async ({ page }) => {
  const program = await newProgram();
  const today = await gymToday();
  const { data: enrollment } = await db().from("enrollments").insert({
    gym_id: program.gym_id, program_id: program.id, user_id: "00000000-0000-4000-a000-000000000011",
    start_date: addDays(today, 30), status: "paused", source: "comp",
  }).select().single().throwOnError();
  try {
    await signIn(page, "owner@furyco.test");
    await page.goto(`/admin/programs/${program.id}`);
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Alex Athlete" }) });
    await row.getByText("Edit", { exact: true }).click();
    const form = row.locator("form");
    const save = form.getByRole("button", { name: "Save", exact: true });
    await form.getByRole("combobox", { name: "Status", exact: true }).selectOption("active");
    await submit(page, save);
    await expect(form.getByRole("status")).toContainText("Enrollment updated");
    await expect(form.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("active");
    await submit(page, save);
    await expect(save).toBeEnabled();
    const first = await db().from("enrollments").select("status,expires_at").eq("id", enrollment!.id).single().throwOnError();
    expect(first.data!.status).toBe("active");

    await form.getByLabel("Start date").fill(addDays(today, 60));
    await submit(page, save);
    await expect(save).toBeEnabled();
    const moved = await db().from("enrollments").select("status,start_date,expires_at").eq("id", enrollment!.id).single().throwOnError();
    expect(moved.data!.expires_at).not.toBe(first.data!.expires_at);
    await expect(form.getByLabel("Access until")).toHaveValue(moved.data!.expires_at);
    await submit(page, save);
    await expect(save).toBeEnabled();
    const repeated = await db().from("enrollments").select("status,start_date,expires_at").eq("id", enrollment!.id).single().throwOnError();
    expect(repeated.data).toEqual(moved.data);
  } finally {
    await db().from("enrollments").delete().eq("id", enrollment!.id).throwOnError();
    await db().from("programs").delete().eq("id", program.id).throwOnError();
  }
});

test("an unchanged save cannot undo an owner's coach downgrade", async ({ page }) => {
  const { data: gym } = await db().from("gyms").select("id").eq("is_default", true).single().throwOnError();
  const { data, error } = await db().auth.admin.createUser({
    email: `role-form-${randomUUID()}@example.test`, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: "Form Role Fixture" },
  });
  expect(error).toBeNull();
  const user = data.user!;
  try {
    await db().from("gym_members").upsert({ gym_id: gym!.id, user_id: user.id, role: "coach" }).throwOnError();
    await signIn(page, "owner@furyco.test");
    await page.goto(`/admin/members/${user.id}`);
    const form = page.locator("form").filter({ has: page.getByLabel("Access level") });
    await expect(form.getByLabel("Access level")).toHaveValue("coach");
    await form.getByLabel("Access level").selectOption("athlete");
    await submit(page, form.getByRole("button", { name: "Save", exact: true }));
    await expect(form.getByRole("status")).toContainText("Role updated");
    await expect(form.getByLabel("Access level")).toHaveValue("athlete");
    await submit(page, form.getByRole("button", { name: "Save", exact: true }));
    await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    const saved = await db().from("gym_members").select("role").eq("gym_id", gym!.id).eq("user_id", user.id).single().throwOnError();
    expect(saved.data!.role).toBe("athlete");
    await page.reload();
    await expect(form.getByLabel("Access level")).toHaveValue("athlete");
  } finally {
    const { error: cleanupError } = await db().auth.admin.deleteUser(user.id);
    expect(cleanupError).toBeNull();
  }
});

test("create forms retain invalid input but clear after a successful retry", async ({ page }) => {
  const name = `Form exercise ${randomUUID()}`;
  try {
    await signIn(page, "coach@furyco.test");
    await page.goto("/admin/exercises");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add exercise", exact: true }) });
    await form.getByLabel("Name", { exact: true }).fill("   ");
    await form.getByLabel("Coaching cues").fill("Keep these cues");
    await form.getByRole("checkbox", { name: "Load", exact: true }).check();
    await submit(page, form.getByRole("button", { name: "Add exercise", exact: true }));
    await expect(form.getByRole("alert")).toContainText("Give the exercise a name");
    await expect(form.getByLabel("Coaching cues")).toHaveValue("Keep these cues");
    await expect(form.getByRole("checkbox", { name: "Load", exact: true })).toBeChecked();
    await form.getByLabel("Name", { exact: true }).fill(name);
    await submit(page, form.getByRole("button", { name: "Add exercise", exact: true }));
    await expect(form.getByRole("status")).toContainText(`Added ${name}`);
    await expect(form.getByLabel("Name", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("Coaching cues")).toHaveValue("");
    await expect(form.getByRole("checkbox", { name: "Load", exact: true })).not.toBeChecked();
    const { data } = await db().from("exercises").select("cues,default_metrics").eq("name", name).single().throwOnError();
    expect(data).toEqual({ cues: "Keep these cues", default_metrics: ["load"] });
  } finally {
    await db().from("exercises").delete().eq("name", name).throwOnError();
  }
});
