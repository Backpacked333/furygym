import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { asUser, db, PASSWORD, signIn } from "./helpers";

test.beforeAll(() => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost").hostname);
});

test("a delivered recovery link works in another browser, changes the password and cannot be reused", async ({ page, browser, request }) => {
  const email = `recovery-${randomUUID()}@example.test`;
  const created = await db().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  const other = await browser.newContext();
  try {
    await page.goto("/reset-password?request=1");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByRole("status")).toContainText("reset link is on its way");
    let messageId: string | undefined;
    await expect.poll(async () => {
      const response = await request.get("http://127.0.0.1:54324/api/v1/search", { params: { query: `to:${email}` } });
      const result = await response.json();
      messageId = result.messages[0]?.ID;
      return Boolean(messageId);
    }).toBe(true);
    const emailResponse = await request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`);
    const content = (await emailResponse.json()).HTML as string;
    const link = content.match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
    if (!link) throw new Error("Recovery email did not include a link");
    const recovered = await other.newPage();
    // Never include a one-time email token in a failing navigation message.
    await recovered.goto(link).catch(() => { throw new Error("Could not open the recovery email link"); });
    await expect(recovered.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await recovered.getByLabel("New password", { exact: true }).fill("NewFuryPassword456!");
    await recovered.getByLabel("Confirm new password").fill("NewFuryPassword456!");
    await recovered.getByRole("button", { name: "Update password" }).click();
    await expect(recovered.getByRole("status")).toContainText("Password updated");
    await expect(asUser(email)).rejects.toThrow();
    const authenticated = await asUser(email, "NewFuryPassword456!");
    expect((await authenticated.auth.getUser()).data.user?.id).toBe(created.data.user.id);
    await recovered.goto(link).catch(() => { throw new Error("Could not check a reused recovery link"); });
    await expect(recovered.getByRole("main").getByRole("alert")).toContainText("invalid, expired");
    await expect(recovered.getByLabel("New password", { exact: true })).toHaveCount(0);
  } finally {
    await other.close();
    await db().auth.admin.deleteUser(created.data.user.id);
  }
});

test("one-off scheduling rejects a missing DST time without losing staff input", async ({ page }) => {
  const title = `DST regression ${randomUUID()}`;
  await signIn(page, "owner@furyco.test");
  await page.goto("/admin/schedule");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add class", exact: true }) });
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("Date", { exact: true }).fill("2027-03-14");
  await form.getByLabel("Start time").fill("02:30");
  await form.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("does not exist");
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(title);
  expect((await db().from("class_sessions").select("id").eq("title", title).throwOnError()).data).toHaveLength(0);
  await form.getByLabel("Start time").fill("03:30");
  await form.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(form.getByRole("status")).toHaveText("Class added.");
  try {
    const row = (await db().from("class_sessions").select("starts_at").eq("title", title).single().throwOnError()).data!;
    expect(new Date(row.starts_at).toISOString()).toBe("2027-03-14T08:30:00.000Z");
  } finally {
    await db().from("class_sessions").delete().eq("title", title).throwOnError();
  }
});
