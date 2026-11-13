import { expect, test } from "@playwright/test";
import { addDays, asUser, db, gymToday, signIn } from "./helpers";

const gymId = async () => (await db().from("gyms").select("id").eq("is_default", true).single()).data!.id as string;

test.describe("reports stay complete as the gym grows", () => {
  const MARK = "Paging test";
  const TOTAL = 1050;

  test.beforeAll(async () => {
    const gym = await gymId();
    const base = Date.parse("2020-01-10T15:00:00Z");
    // Oldest first: five refunds and three failures sit far below the newest 200 rows.
    const rows = Array.from({ length: TOTAL }, (_, i) => {
      const at = new Date(base + i * 60_000).toISOString();
      const failed = i >= 5 && i < 8;
      return {
        gym_id: gym,
        kind: "membership",
        revenue_stream: "facility",
        description: `${MARK} ${i}`,
        amount_cents: 1000,
        refunded_cents: i < 5 ? 400 : 0,
        status: i < 5 ? "partially_refunded" : failed ? "failed" : "succeeded",
        failure_reason: failed ? "card_declined" : null,
        paid_at: failed ? null : at,
        created_at: at,
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db().from("payments").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  });

  test.afterAll(async () => {
    await db().from("payments").delete().like("description", `${MARK} %`);
  });

  test("an export longer than one page of the API has every payment", async ({ page }) => {
    await signIn(page, "owner@furyco.test");
    const csv = await page.request.get("/admin/reports/export?type=payments&from=2020-01-01&to=2020-01-31");
    expect(csv.status()).toBe(200);
    const lines = (await csv.text()).trim().split("\r\n").slice(1);
    expect(lines).toHaveLength(TOTAL);
    expect(new Set(lines.map((l) => l.match(/Paging test \d+/)?.[0])).size).toBe(TOTAL);
  });

  test("refunds and failures older than the newest 200 are still listed, and a cut list says so", async ({ page }) => {
    await signIn(page, "owner@furyco.test");
    const range = "from=2020-01-01&to=2020-01-31";
    await page.goto(`/admin/reports?${range}`);
    await expect(page.getByTestId("transaction-row")).toHaveCount(200);
    await expect(page.getByTestId("transactions-more")).toContainText(`Showing the newest 200 of ${TOTAL}`);
    await expect(page.getByTestId("refund-count")).toHaveText("5 refunded payments");

    await page.goto(`/admin/reports?${range}&show=refunds`);
    await expect(page.getByTestId("transaction-row")).toHaveCount(5);
    await expect(page.getByTestId("transaction-row").first()).toContainText("Refunded $4.00");
    await expect(page.getByTestId("transactions-more")).toHaveCount(0);
    const refunds = await page.request.get(`/admin/reports/export?type=payments&${range}&show=refunds`);
    expect(refunds.headers()["content-disposition"]).toContain("furyco-refunds-2020-01-01-to-2020-01-31.csv");
    expect((await refunds.text()).trim().split("\r\n").slice(1)).toHaveLength(5);

    await page.goto(`/admin/reports?${range}&show=failed`);
    await expect(page.getByTestId("transaction-row")).toHaveCount(3);
    await expect(page.getByTestId("transaction-row").first()).toContainText("card_declined");
  });
});

test.describe("member page", () => {
  test("counts every logged workout, not only the eight it lists", async ({ page }) => {
    const admin = db();
    const gym = await gymId();
    const stamp = Date.now();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `logcount-${stamp}@test.furyco.test`,
      password: "FuryDemo123!",
      email_confirm: true,
      user_metadata: { full_name: "Logcount Athlete" },
    });
    if (error) throw error;
    const userId = created.user!.id;
    const { data: workouts, error: workoutError } = await admin
      .from("workouts")
      .insert(Array.from({ length: 11 }, (_, i) => ({ gym_id: gym, title: `Logcount ${stamp}-${i}`, scheduled_date: `2020-02-${String(i + 1).padStart(2, "0")}`, status: "draft" })))
      .select("id, scheduled_date");
    if (workoutError) throw workoutError;
    try {
      const { error: logError } = await admin
        .from("workout_logs")
        .insert(workouts!.map((w) => ({ gym_id: gym, user_id: userId, workout_id: w.id, performed_on: w.scheduled_date })));
      if (logError) throw logError;

      await signIn(page, "coach@furyco.test");
      await page.goto(`/admin/members/${userId}`);
      await expect(page.getByTestId("workouts-logged")).toHaveText("11");
    } finally {
      await admin.auth.admin.deleteUser(userId);
      await admin.from("workouts").delete().in("id", workouts!.map((w) => w.id));
    }
  });
});

test.describe("change log", () => {
  test("an admin sees who changed a role and what it was before; a coach cannot open it", async ({ page, browser }) => {
    const owner = await asUser("owner@furyco.test");
    const gym = await gymId();
    const { data: jordan } = await db().from("profiles").select("id, full_name").eq("email", "jordan@furyco.test").single();
    const setRole = (role: string) => owner.from("gym_members").update({ role }).eq("gym_id", gym).eq("user_id", jordan!.id).select("role").single();
    try {
      expect((await setRole("coach")).data?.role).toBe("coach");

      await signIn(page, "owner@furyco.test");
      await page.getByRole("link", { name: "Activity" }).click();
      await expect(page).toHaveURL(/\/admin\/activity/);
      const row = page.getByRole("row").filter({ hasText: "Role: athlete → coach" }).first();
      await expect(row).toContainText("Changed · Role or access");
      await expect(row).toContainText(jordan!.full_name);
      await expect(row.getByRole("cell").nth(1)).not.toContainText("System");
      await page.goto("/admin/activity?show=membership_plans");
      await expect(page.getByText("Role: athlete → coach")).toHaveCount(0);
      await page.screenshot({ path: "test-results/activity.png", fullPage: true });
    } finally {
      await setRole("athlete");
    }

    const context = await browser.newContext();
    const coachPage = await context.newPage();
    await signIn(coachPage, "coach@furyco.test");
    await expect(coachPage.getByRole("link", { name: "Activity" })).toHaveCount(0);
    await coachPage.goto("/admin/activity");
    await expect(coachPage).toHaveURL(/\/admin\?denied=1/);
    await context.close();
  });
});

test("a freeze made from the console is logged under the staff member who made it", async ({ page }) => {
  const admin = db();
  const gym = await gymId();
  const name = `Freeze Actor ${Date.now()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `freeze-actor-${Date.now()}@test.furyco.test`,
    password: "FuryDemo123!",
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;
  const userId = created.user!.id;
  try {
    const { data: plan } = await admin.from("membership_plans").select("id").eq("kind", "recurring").limit(1).single();
    const { error: membershipError } = await admin.from("memberships").insert({ gym_id: gym, user_id: userId, plan_id: plan!.id });
    if (membershipError) throw membershipError;
    const { data: owner } = await admin.from("profiles").select("full_name").eq("email", "owner@furyco.test").single();

    await signIn(page, "owner@furyco.test");
    await page.goto(`/admin/members/${userId}`);
    await page.getByLabel("Freeze until").fill(addDays(await gymToday(), 14));
    await page.getByRole("button", { name: "Freeze", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unfreeze" })).toBeVisible();

    await page.goto("/admin/activity?show=memberships");
    const row = page.getByRole("row").filter({ hasText: name }).filter({ hasText: "active → frozen" }).first();
    await expect(row.getByRole("cell").nth(1)).toHaveText(owner!.full_name);
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});

test("an athlete who signed the old waiver is asked to sign a new version, and the request goes once signed", async ({ page }) => {
  const admin = db();
  const gym = await gymId();
  const owner = await asUser("owner@furyco.test");
  const { data: before } = await admin.from("waivers").select("id, active").eq("gym_id", gym);
  const { data: published, error } = await owner.rpc("publish_waiver", { p_gym: gym, p_title: "Revised agreement", p_body: "I understand the risks of training and accept them on my own behalf." });
  if (error) throw error;
  try {
    await signIn(page, "alex@furyco.test");
    await page.goto("/account");
    await expect(page.getByText("Please sign: Revised agreement")).toBeVisible();
    await page.getByLabel("I have read and agree to the above.").check();
    await page.getByLabel("Type your full legal name to sign").fill("Alex Athlete");
    await page.getByRole("button", { name: "Sign agreement" }).click();
    await expect(page.getByText("Please sign:")).toHaveCount(0);
    const { data: signature } = await admin.from("waiver_signatures").select("signed_name").eq("waiver_id", published.id).single();
    expect(signature!.signed_name).toBe("Alex Athlete");
  } finally {
    await admin.from("waiver_signatures").delete().eq("waiver_id", published.id);
    await admin.from("waivers").delete().eq("id", published.id);
    for (const w of (before ?? []).filter((w) => w.active)) await admin.from("waivers").update({ active: true }).eq("id", w.id);
  }
});

test.describe("deployment basics", () => {
  test("the health check answers without signing in and gives nothing away", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    const body = await health.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
    expect(Object.keys(body).sort()).toEqual(["database", "payments", "status"]);
    expect(health.headers()["cache-control"]).toBe("no-store");
  });

  test("pages cannot be framed, private areas are not indexed, and the display link is not leaked", async ({ request }) => {
    const login = (await request.get("/login")).headers();
    expect(login["x-frame-options"]).toBe("DENY");
    expect(login["x-content-type-options"]).toBe("nosniff");
    expect(login["strict-transport-security"]).toContain("max-age=");
    expect(login["x-powered-by"]).toBeUndefined();
    expect(login["x-robots-tag"]).toBeUndefined();

    const display = (await request.get("/display/not-a-real-link")).headers();
    expect(display["referrer-policy"]).toBe("no-referrer");
    expect(display["x-robots-tag"]).toContain("noindex");
    expect((await request.get("/api/health")).headers()["x-robots-tag"]).toContain("noindex");

    const robots = await (await request.get("/robots.txt")).text();
    for (const path of ["/admin", "/account", "/display", "/api"]) expect(robots).toContain(`Disallow: ${path}`);
  });

  test("an unknown address shows a page that leads back, with a 404 status", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response!.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to start" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
