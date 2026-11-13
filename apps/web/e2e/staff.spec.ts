import { expect, test } from "@playwright/test";
import { addDays, asUser, db, gymToday, signIn } from "./helpers";

test.describe("coach publishes a workout", () => {
  test("a published workout reaches the gym display and the athlete's calendar; a scheduled one does not yet", async ({ page }) => {
    const today = await gymToday();
    const liveTitle = `E2E Grinder ${Date.now()}`;
    const laterTitle = `E2E Later ${Date.now()}`;

    await signIn(page, "coach@furyco.test");
    await expect(page).toHaveURL(/\/admin$/);

    // --- build and publish now -------------------------------------------------------------
    await page.goto(`/admin/programming/workouts/new?date=${today}`, { waitUntil: "networkidle" });
    await page.getByLabel("Title").first().fill(liveTitle);
    await page.getByLabel("Track").selectOption({ label: "Strength" });
    await page.getByRole("textbox", { name: /^Overview/ }).fill("Heavy pulls, then carries.");
    // adding a movement from the library creates a block with its title and logging fields
    await page.getByLabel("Search exercises").fill("dead");
    await page.getByRole("button", { name: /Deadlift/ }).click();

    const item = page.getByTestId("workout-item").first();
    await expect(item.getByLabel("Title")).toHaveValue("Deadlift");
    await item.getByLabel("Section").fill("Strength");
    await item.getByLabel("Prescription").fill("5 x 3 @ 85%");
    // the inspector controls what athletes record for the selected block
    await expect(page.getByRole("heading", { name: "Logging · Block A" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Load" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Reps" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("switch", { name: "RPE" }).click();

    await page.getByText("Publish now").click();
    await page.getByRole("button", { name: "Save workout" }).click();
    await expect(page).toHaveURL(/\/admin\/programming\?week=/);
    const card = page.getByRole("link", { name: new RegExp(liveTitle) });
    await expect(card).toContainText("Published");

    // --- build and schedule for tomorrow evening --------------------------------------------
    await page.goto(`/admin/programming/workouts/new?date=${today}`, { waitUntil: "networkidle" });
    await page.getByLabel("Title").first().fill(laterTitle);
    await page.getByLabel("Track").selectOption({ label: "Strength" });
    // a workout with no blocks would put a bare title on the display, so it cannot be published
    await page.getByText("Publish now").click();
    await page.getByRole("button", { name: "Save workout" }).click();
    await expect(page.getByText("Add at least one block before publishing. Save it as a draft until then.")).toBeVisible();
    expect((await db().from("workouts").select("id").eq("title", laterTitle)).data).toHaveLength(0);
    await page.getByLabel("Search exercises").fill("dead");
    await page.getByRole("button", { name: /Deadlift/ }).click();
    await page.getByText("Schedule", { exact: true }).click();
    await page.getByLabel("Publish date").fill(addDays(today, 1));
    await page.getByLabel("Publish time").fill("18:00");
    await page.getByRole("button", { name: "Save workout" }).click();
    await expect(page.getByRole("link", { name: new RegExp(laterTitle) })).toContainText("Scheduled");

    // --- what was stored --------------------------------------------------------------------
    const { data: stored } = await db().from("workouts").select("id, status, publish_at, workout_items(title, metrics, prescription, exercise_id)").eq("title", liveTitle).single();
    expect(stored!.status).toBe("published");
    expect(stored!.workout_items).toHaveLength(1);
    expect(stored!.workout_items[0]).toMatchObject({ title: "Deadlift", metrics: ["load", "reps", "rpe"], prescription: "5 x 3 @ 85%" });
    expect(stored!.workout_items[0].exercise_id).not.toBeNull();

    // --- gym display --------------------------------------------------------------------------
    await page.goto("/display/demo-display-token");
    await expect(page.getByRole("heading", { name: liveTitle })).toBeVisible();
    await expect(page.getByText("5 x 3 @ 85%")).toBeVisible();
    await expect(page.getByText(laterTitle)).toHaveCount(0);
    await page.screenshot({ path: "test-results/display.png" });

    // --- athlete's view (what the iOS app reads) ----------------------------------------------
    const alex = await asUser("alex@furyco.test");
    const calendar = await alex.rpc("my_calendar", { p_from: today, p_to: today });
    const titles = (calendar.data as { title: string }[]).map((r) => r.title);
    expect(titles).toContain(liveTitle);
    expect(titles).not.toContain(laterTitle);
    const items = await alex.from("workout_items").select("title, metrics").eq("workout_id", stored!.id);
    expect(items.data).toEqual([{ title: "Deadlift", metrics: ["load", "reps", "rpe"] }]);

    // --- edit keeps the item identity, so logged results stay attached -----------------------
    const before = await db().from("workout_items").select("id").eq("workout_id", stored!.id).single();
    await page.goto(`/admin/programming/workouts/${stored!.id}`, { waitUntil: "networkidle" });
    const prescription = page.getByTestId("workout-item").first().getByLabel("Prescription");
    await expect(prescription).toHaveValue("5 x 3 @ 85%");
    await prescription.fill("5 x 3 @ 87.5%");
    await expect(prescription).toHaveValue("5 x 3 @ 87.5%");
    await page.getByRole("button", { name: "Save workout" }).click();
    await expect(page).toHaveURL(/\/admin\/programming\?week=/);
    const after = await db().from("workout_items").select("id, prescription").eq("workout_id", stored!.id).single();
    expect(after.data).toEqual({ id: before.data!.id, prescription: "5 x 3 @ 87.5%" });

    await db().from("workouts").delete().in("title", [liveTitle, laterTitle]);
  });

  test("staff control what the display shows", async ({ page }) => {
    await signIn(page, "coach@furyco.test");
    await page.goto("/admin/display");
    await page.getByLabel("Message banner").fill("Open gym until 8pm");
    await page.getByLabel("Track (today's workout mode)").selectOption({ label: "Engine only" });
    await page.getByRole("button", { name: "Update display" }).click();
    await expect(page.getByRole("status")).toContainText("Display updated");

    await page.goto("/display/demo-display-token");
    await expect(page.getByText("Open gym until 8pm")).toBeVisible();
    await expect(page.getByTestId("display-workout")).toHaveCount(1);
    await expect(page.getByTestId("display-workout")).toContainText("Engine");

    const bad = await page.goto("/display/not-the-token");
    expect(bad!.status()).toBe(404);

    await db().from("display_state").update({ track_id: null, message: null }).not("gym_id", "is", null);
  });
});

test.describe("gym screen reliability", () => {
  test("a screen keeps the workout through an outage, says it is offline, and goes blank when its link is replaced", async ({ page }) => {
    // the screen refreshes once as it opens; let that finish so the checks below drive every later refresh
    const opened = page.waitForResponse((r) => r.url().includes("/api/display/"));
    await page.goto("/display/demo-display-token");
    await opened;
    const board = page.getByRole("main");
    await expect(board).toHaveAttribute("data-status", "live");
    await expect(page.getByTestId("display-workout").first()).toBeVisible();
    // the screen re-checks as soon as the browser says the network is back
    const recheck = () => page.evaluate(() => window.dispatchEvent(new Event("online")));

    await page.route("**/api/display/**", (route) => route.abort());
    await recheck();
    await expect(board).toHaveAttribute("data-status", "stale");
    await expect(page.getByText(/Offline · last updated .+ · reconnecting/)).toBeVisible();
    await expect(page.getByTestId("display-workout").first()).toBeVisible();

    // a server error is an outage too, not a reason to blank the screen
    await page.unroute("**/api/display/**");
    await page.route("**/api/display/**", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
    await recheck();
    await expect(board).toHaveAttribute("data-status", "stale");
    await expect(page.getByTestId("display-workout").first()).toBeVisible();

    await page.unroute("**/api/display/**");
    await recheck();
    await expect(board).toHaveAttribute("data-status", "live");
    await expect(page.getByText(/Offline/)).toHaveCount(0);

    // replacing the link: the real endpoint answers "not found" for a token that no longer exists
    const gone = await page.request.get("/api/display/not-the-token");
    expect(gone.status()).toBe(404);
    expect(await gone.json()).toEqual({ error: "not_found" });
    await page.route("**/api/display/**", (route) => route.fulfill({ status: 404, json: { error: "not_found" } }));
    await recheck();
    await expect(board).toHaveAttribute("data-status", "revoked");
    await expect(page.getByText("This display link is no longer active")).toBeVisible();
    await expect(page.getByTestId("display-workout")).toHaveCount(0);
    await expect(page.getByTestId("display-class")).toHaveCount(0);
    await page.screenshot({ path: "test-results/display-revoked.png" });
  });

  test("the console reports whether a screen is really connected; a staff preview does not count", async ({ page, context }) => {
    const seenAt = async () => (await db().from("gym_secrets").select("display_seen_at").single()).data!.display_seen_at;
    await db().from("gym_secrets").update({ display_seen_at: null }).not("gym_id", "is", null);

    await signIn(page, "coach@furyco.test");
    await page.goto("/admin/display");
    await expect(page.getByTestId("screen-status")).toContainText("Not set up");

    const previewed = context.waitForEvent("response", (r) => r.url().includes("/api/display/") && r.url().includes("preview"));
    const popup = context.waitForEvent("page");
    await page.getByRole("link", { name: "Open full preview" }).click();
    const preview = await popup;
    expect((await previewed).status()).toBe(200);
    await expect(preview.getByRole("main")).toHaveAttribute("data-status", "live");
    expect(await seenAt()).toBeNull();
    await preview.close();

    const tv = await context.newPage();
    await tv.goto("/display/demo-display-token");
    await expect.poll(seenAt).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId("screen-status")).toContainText("Connected");
    await expect(page.getByTestId("screen-status")).not.toContainText("Not connected");
    await tv.close();

    // a screen that stopped checking in is reported as such
    await db().from("gym_secrets").update({ display_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() }).not("gym_id", "is", null);
    await page.reload();
    await expect(page.getByTestId("screen-status")).toContainText("Not connected");
  });

  test("a screen whose own date is wrong keeps today's workout when it starts offline", async ({ page }) => {
    await page.clock.install({ time: Date.now() + 2 * 86_400_000 });
    await page.route("**/api/display/**", (route) => route.abort());
    await page.goto("/display/demo-display-token");
    const board = page.locator("main");
    await expect(board).toHaveAttribute("data-status", "stale");
    await expect(board).toContainText("Back Squat");
    await expect(board).toContainText("Offline");
  });

  test("replacing the link forgets the old link's screen", async ({ page }) => {
    const secrets = () => db().from("gym_secrets");
    await secrets().update({ display_seen_at: new Date().toISOString() }).not("gym_id", "is", null);
    try {
      await signIn(page, "owner@furyco.test");
      await page.goto("/admin/display");
      await expect(page.getByTestId("screen-status")).toContainText("Connected");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: /^Replace/ }).click();
      // nothing has opened the new link, so the console must not say a screen is on it
      await expect(page.getByTestId("screen-status")).toContainText("Not set up");
      const { data } = await secrets().select("display_token, display_seen_at").single();
      expect(data!.display_token).not.toBe("demo-display-token");
      expect(data!.display_seen_at).toBeNull();
      expect((await page.request.get("/api/display/demo-display-token")).status()).toBe(404);
    } finally {
      await secrets().update({ display_token: "demo-display-token", display_seen_at: null }).not("gym_id", "is", null);
    }
  });

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    test(`a long workout is shrunk to fit a ${viewport.width}x${viewport.height} screen, and a day too long for it says so`, async ({ page }) => {
      const today = await gymToday();
      const title = `E2E Long Day ${Date.now()}`;
      const { data: track } = await db().from("tracks").select("id, gym_id").eq("slug", "strength").single();
      const { data: workout, error } = await db()
        .from("workouts")
        .insert({ gym_id: track!.gym_id, track_id: track!.id, title, scheduled_date: today, status: "published", publish_at: new Date(Date.now() - 60_000).toISOString() })
        .select("id")
        .single();
      if (error) throw error;
      const items = Array.from({ length: 8 }, (_, i) => ({
        workout_id: workout!.id,
        position: i,
        section: `Part ${i + 1}`,
        title: `Long block ${i + 1}`,
        prescription: "5 rounds for time:\n20 wall balls (20/14)\n15 toes-to-bar\n10 power cleans (135/95)\n400 m run\nRest 2:00 between rounds",
        scaling: "Reduce the load, hang knee raises, 300 m run",
      }));
      await db().from("workout_items").insert(items);
      const state = (values: Record<string, unknown>) => db().from("display_state").update(values).not("gym_id", "is", null);
      const board = page.getByRole("main");
      const overflow = () => board.evaluate((el) => el.scrollHeight - el.clientHeight);

      try {
        await page.setViewportSize(viewport);

        // pinned on its own, the eight-block workout is shrunk until all of it is on the screen
        await state({ mode: "manual", workout_id: workout!.id, show_coach_notes: true, message: "Bring a friend Friday — guests train free" });
        await page.goto("/display/demo-display-token");
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        await expect.poll(overflow).toBeLessThanOrEqual(1);
        await expect(page.getByTestId("display-overflow")).toBeHidden();
        for (const block of await page.getByText(/^Long block \d$/).all()) await expect(block).toBeInViewport({ ratio: 1 });
        const pinned = await page.getByTestId("display-workout").boundingBox();
        expect(pinned!.y + pinned!.height).toBeLessThanOrEqual(viewport.height);
        await page.screenshot({ path: `test-results/display-long-${viewport.width}.png` });

        // with every track's workout on as well they cannot share the screen at a readable size, so they take
        // turns: one workout at a time, at full size, and the screen never scrolls
        await state({ mode: "auto", workout_id: null });
        await page.goto("/display/demo-display-token");
        const workouts = page.getByTestId("display-workout");
        await expect(workouts).toHaveCount(3);
        await expect(board).toHaveAttribute("data-paged", "");
        await expect(workouts.filter({ visible: true })).toHaveCount(1);
        await expect(page.getByTestId("display-turn").filter({ visible: true })).toHaveText(/^[123] of 3$/);
        expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `test-results/display-turns-${viewport.width}.png` });
      } finally {
        await state({ mode: "auto", workout_id: null, show_coach_notes: false, message: null });
        await db().from("workouts").delete().eq("id", workout!.id);
      }
    });
  }
});

test.describe("front desk", () => {
  test("admin adds a member to a class and checks them in", async ({ page }) => {
    const { data: session } = await db()
      .from("class_sessions")
      .select("id, title")
      .gt("starts_at", new Date(Date.now() + 2 * 3600_000).toISOString())
      .eq("status", "scheduled")
      .gte("capacity", 10)
      .order("starts_at")
      .limit(1)
      .single();

    // Start from the seeded state so the test can be run repeatedly.
    const samId = "00000000-0000-4000-a000-000000000012";
    await db().from("bookings").delete().eq("session_id", session!.id).eq("user_id", samId);
    await db().from("memberships").update({ credits_remaining: 7 }).eq("user_id", samId);

    await signIn(page, "owner@furyco.test");
    await page.goto(`/admin/schedule/sessions/${session!.id}`);
    await expect(page.getByRole("heading", { name: session!.title })).toBeVisible();

    await page.getByLabel("Member").selectOption({ label: "Sam Packholder" });
    await page.getByRole("button", { name: "Add to class" }).click();
    const row = page.getByTestId("roster-row").filter({ hasText: "Sam Packholder" });
    await expect(row).toContainText("booked");
    await expect(row).toContainText("class credit"); // Sam is on a 10-class pack

    await row.getByRole("button", { name: "Check in" }).click();
    await expect(row).toContainText("attended");

    const { data: booking } = await db().from("bookings").select("status, credit_used, checked_in_at").eq("session_id", session!.id).eq("user_id", samId).single();
    expect(booking).toMatchObject({ status: "attended", credit_used: true });
    expect(booking!.checked_in_at).not.toBeNull();
    const { data: pack } = await db().from("memberships").select("credits_remaining").eq("user_id", samId).single();
    expect(pack!.credits_remaining).toBe(6); // seeded with 7

    // removing the athlete hands the credit back
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("roster-row").filter({ hasText: "Sam Packholder" })).toHaveCount(0);
    const { data: restored } = await db().from("memberships").select("credits_remaining").eq("user_id", samId).single();
    expect(restored!.credits_remaining).toBe(7);
  });

  test("report totals match the payments table, and the CSV export has every payment", async ({ page }) => {
    const today = await gymToday();
    const from = addDays(today, -89);
    const { data: gym } = await db().from("gyms").select("id, timezone").eq("is_default", true).single();
    const owner = await asUser("owner@furyco.test");
    const { data: rows } = await owner.rpc("report_revenue", { p_gym: gym!.id, p_from: from, p_to: today });
    const total = (key: string) => (rows as Record<string, number>[]).reduce((n, r) => n + Number(r[key]), 0);
    const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
    expect(total("gross_cents")).toBeGreaterThan(0);

    await signIn(page, "owner@furyco.test");
    await page.goto(`/admin/reports?from=${from}&to=${today}`);
    const totalRow = page.getByTestId("revenue-total");
    await expect(totalRow).toContainText(usd(total("gross_cents")));
    await expect(totalRow).toContainText(usd(total("fee_cents")));
    await expect(totalRow).toContainText(usd(total("refunded_cents")));
    await expect(totalRow).toContainText(usd(total("net_cents")));
    await expect(page.getByText("card_declined")).toBeVisible(); // seeded failed payment
    await page.screenshot({ path: "test-results/reports.png", fullPage: true });

    const csv = await page.request.get(`/admin/reports/export?type=payments&from=${from}&to=${today}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe("date,customer,email,revenue_stream,type,description,status,gross_sales,tax,charged,processing_fee,refunded,net,currency,stripe_payment_intent,stripe_invoice");
    const { count } = await db().from("payments").select("id", { count: "exact", head: true });
    expect(lines.length - 1).toBe(count);
    expect(lines.some((l) => l.includes("refunded,25.00,0.00,25.00,1.03,25.00,-1.03"))).toBe(true);
  });

  test("coaches cannot open admin-only areas or export financials", async ({ page }) => {
    await signIn(page, "coach@furyco.test");
    await page.goto("/admin/reports");
    await expect(page).toHaveURL(/\/admin\?denied=1/);
    await expect(page.getByText("limited to admins and owners")).toBeVisible();
    await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
    const csv = await page.request.get("/admin/reports/export?type=payments&from=2026-01-01&to=2026-12-31");
    expect(csv.status()).toBe(403);
  });
});
