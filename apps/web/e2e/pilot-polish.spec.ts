import { expect, test } from "@playwright/test";
import { asUser, db, signIn } from "./helpers";

const ALEX = "alex@furyco.test";
async function profile(email: string) {
  const { data } = await db().from("profiles").select("id, full_name, email").eq("email", email).single();
  return data!;
}
async function gym() {
  const { data } = await db().from("gyms").select("id, milestone_visits").eq("is_default", true).single();
  return data!;
}

test.describe("a class the gym cancels", () => {
  test("staff see who to tell with an email-all link, and the athlete's app is told", async ({ page }) => {
    const alex = await profile(ALEX);
    const { id: gymId } = await gym();
    const starts = new Date(Date.now() + 3 * 86_400_000);
    const { data: session } = await db().from("class_sessions")
      .insert({ gym_id: gymId, title: "Cancel Me Conditioning", starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3600_000).toISOString(), capacity: 8 })
      .select().single();
    try {
      const booked = await db().from("bookings").insert({ gym_id: gymId, session_id: session!.id, user_id: alex.id, status: "booked" });
      expect(booked.error).toBeNull();

      await signIn(page, "owner@furyco.test");
      await page.goto(`/admin/schedule/sessions/${session!.id}`);
      await expect(page.getByTestId("cancelled-athletes")).toHaveCount(0);
      await page.getByLabel("Status").selectOption("cancelled");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Class cancelled" })).toContainText("email them from the list below");

      const list = page.getByTestId("cancelled-athletes");
      await expect(list).toContainText(alex.full_name!);
      await expect(list).toContainText(ALEX);
      const href = await page.getByRole("link", { name: "Email all" }).getAttribute("href");
      expect(href).toMatch(/^mailto:\?bcc=/);
      expect(decodeURIComponent(href!)).toContain(ALEX);
      expect(decodeURIComponent(href!)).toContain("Cancel Me Conditioning is cancelled");

      const app = await asUser(ALEX);
      const { data: mine } = await app.from("class_session_overview").select("status, my_class_cancelled").eq("id", session!.id).single();
      expect(mine).toEqual({ status: "cancelled", my_class_cancelled: true });
    } finally {
      await db().from("bookings").delete().eq("session_id", session!.id);
      await db().from("class_sessions").delete().eq("id", session!.id);
    }
  });
});

test.describe("manager dashboard", () => {
  test("the setup checklist ticks itself off and goes away; coaches never see it", async ({ page, browser }) => {
    const secrets = () => db().from("gym_secrets");
    const { data: before } = await secrets().select("gym_id, display_seen_at").single();
    try {
      await secrets().update({ display_seen_at: null }).eq("gym_id", before!.gym_id);
      await signIn(page, "owner@furyco.test");
      await page.goto("/admin");
      const checklist = page.getByTestId("setup-checklist");
      await expect(checklist.locator('li[data-done="false"]').filter({ hasText: "Open the display link on the gym TV" })).toBeVisible();
      await expect(checklist.locator('li[data-done="true"]').filter({ hasText: "Publish your waiver" })).toBeVisible();
      await expect(page.getByText(/\d of 6 done/)).toBeVisible();

      const coachContext = await browser.newContext();
      const coachPage = await coachContext.newPage();
      await signIn(coachPage, "coach@furyco.test");
      await coachPage.goto("/admin");
      await expect(coachPage.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expect(coachPage.getByTestId("setup-checklist")).toHaveCount(0);
      await coachContext.close();

      await secrets().update({ display_seen_at: new Date().toISOString() }).eq("gym_id", before!.gym_id);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expect(checklist).toHaveCount(0);
    } finally {
      await secrets().update({ display_seen_at: before!.display_seen_at }).eq("gym_id", before!.gym_id);
    }
  });

  test("needs attention lists a failed payment, and a reward stays listed until staff mark it given", async ({ page }) => {
    const alex = await profile(ALEX);
    const { id: gymId, milestone_visits } = await gym();
    const { data: membership } = await db().from("memberships").select("id, status").eq("user_id", alex.id).eq("status", "active").limit(1).single();
    const starts = new Date(Date.now() - 26 * 3600_000);
    const { data: session } = await db().from("class_sessions")
      .insert({ gym_id: gymId, title: "Reward visit", starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3600_000).toISOString(), capacity: 8 })
      .select().single();
    try {
      await db().from("bookings").insert({ gym_id: gymId, session_id: session!.id, user_id: alex.id, status: "attended", checked_in_at: starts.toISOString() });
      await db().from("memberships").update({ status: "past_due" }).eq("id", membership!.id);
      await db().from("gyms").update({ milestone_visits: 1 }).eq("id", gymId);

      await signIn(page, "owner@furyco.test");
      await page.goto("/admin");
      const attention = page.getByTestId("needs-attention");
      await expect(attention.getByRole("heading", { name: /Payment failed/ })).toBeVisible();
      await expect(attention.locator("section").filter({ hasText: "Payment failed" }).getByRole("link", { name: alex.full_name! })).toBeVisible();

      const reward = page.getByTestId("reward-due").filter({ hasText: alex.full_name! });
      await expect(reward).toBeVisible();
      await reward.getByRole("button", { name: "Given" }).click();
      await expect(reward).toHaveCount(0);
      const { data: given } = await db().from("milestone_rewards").select("visits, reward, given_by").eq("user_id", alex.id);
      expect(given).toHaveLength(1);
      expect(given![0].reward).toBe("a free Fury Co. tee");
      expect(given![0].given_by).not.toBeNull();
      await page.reload();
      await expect(page.getByTestId("reward-due").filter({ hasText: alex.full_name! })).toHaveCount(0);
    } finally {
      await db().from("gyms").update({ milestone_visits }).eq("id", gymId);
      await db().from("memberships").update({ status: membership!.status }).eq("id", membership!.id);
      await db().from("milestone_rewards").delete().eq("gym_id", gymId);
      await db().from("bookings").delete().eq("session_id", session!.id);
      await db().from("class_sessions").delete().eq("id", session!.id);
    }
  });
});

test.describe("member list", () => {
  test("filters narrow the list, each count matches its rows, and search works inside a filter", async ({ page }) => {
    const alex = await profile(ALEX);
    await signIn(page, "owner@furyco.test");
    await page.goto("/admin/members");
    const filters = page.getByRole("navigation", { name: "Filter members" });
    const rows = page.locator("tbody tr");
    for (const label of ["Everyone", "Active", "Past due", "Frozen", "No membership", "Staff"]) {
      const chip = filters.getByRole("link", { name: new RegExp(`^${label} \\d+$`) });
      const count = Number((await chip.textContent())!.match(/(\d+)$/)![1]);
      await chip.click();
      await expect(chip).toHaveAttribute("aria-current", "page");
      await expect(rows).toHaveCount(count);
    }
    // Staff: the coach, not an athlete
    await expect(page.getByRole("link", { name: "Casey Coach" })).toBeVisible();
    await expect(page.getByRole("link", { name: alex.full_name! })).toHaveCount(0);

    await filters.getByRole("link", { name: /^Active/ }).click();
    await expect(page.getByRole("link", { name: alex.full_name! })).toBeVisible();
    await page.getByPlaceholder("Search by name or email").fill("alex@");
    await page.getByPlaceholder("Search by name or email").press("Enter");
    await expect(page).toHaveURL(/show=active/);
    await expect(rows).toHaveCount(1);
    await expect(filters.getByRole("link", { name: /^Active/ })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("exercise library", () => {
  test("the starter library adds common movements once and leaves existing ones alone", async ({ page }) => {
    const { data: before } = await db().from("exercises").select("id, name, cues");
    const keep = (before ?? []).map((e) => e.id);
    try {
      await signIn(page, "coach@furyco.test");
      await page.goto("/admin/exercises");
      await page.getByRole("button", { name: "Add the starter library" }).click();
      await expect(page.getByRole("heading", { name: "Starter library" })).toHaveCount(0);
      await expect(page.getByText("Clean and Jerk").first()).toBeVisible();

      const { data: after } = await db().from("exercises").select("id, name, cues, category, default_metrics");
      expect(after!.length).toBeGreaterThanOrEqual(50);
      const squats = after!.filter((e) => e.name.toLowerCase() === "back squat");
      expect(squats).toHaveLength(1);
      expect(squats[0].cues).toBe(before!.find((e) => e.name === "Back Squat")!.cues);
      expect(after!.find((e) => e.name === "Thruster")).toMatchObject({ category: "Weightlifting", default_metrics: ["load", "sets", "reps"] });
    } finally {
      await db().from("exercises").delete().not("id", "in", `(${keep.join(",")})`);
    }
  });
});

test.describe("privacy, terms and support pages", () => {
  test("are public, say so while the wording is pending, and show what the owner saves", async ({ page, browser }) => {
    const { id: gymId } = await gym();
    await db().from("gym_legal").delete().eq("gym_id", gymId);
    const visitor = await (await browser.newContext()).newPage();
    try {
      for (const [path, title] of [["/privacy", "Privacy policy"], ["/terms", "Terms of service"]] as const) {
        const response = await visitor.goto(path);
        expect(response!.status()).toBe(200);
        await expect(visitor.getByRole("heading", { name: title })).toBeVisible();
        await expect(visitor.getByText("is being finalised and will be published here")).toBeVisible();
      }
      await visitor.goto("/support");
      await expect(visitor.getByText("ask at the front desk")).toBeVisible();
      await visitor.goto("/");
      await expect(visitor.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" })).toBeVisible();

      await signIn(page, "owner@furyco.test");
      await page.goto("/admin/plans");
      await page.getByLabel("Support email").fill("help@furyco.test");
      await page.getByLabel("Privacy policy").fill("We keep your training data private.\n\nSecond paragraph.");
      await page.getByLabel("Terms of service").fill("Train hard, be kind.");
      await page.getByRole("button", { name: "Save pages" }).click();
      await expect(page.getByRole("status").filter({ hasText: "The public pages now show this text" })).toBeVisible();

      await visitor.goto("/privacy");
      await expect(visitor.getByText("We keep your training data private.")).toBeVisible();
      await expect(visitor.getByText("is being finalised")).toHaveCount(0);
      await expect(visitor.getByText(/Last updated/)).toBeVisible();
      await visitor.goto("/terms");
      await expect(visitor.getByText("Train hard, be kind.")).toBeVisible();
      await visitor.goto("/support");
      await expect(visitor.getByRole("link", { name: "help@furyco.test" })).toHaveAttribute("href", "mailto:help@furyco.test");
    } finally {
      await db().from("gym_legal").delete().eq("gym_id", gymId);
      await visitor.context().close();
    }
  });
});
