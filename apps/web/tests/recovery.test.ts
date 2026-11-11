import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(), exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import { sendPasswordReset } from "@/app/login/actions";
import { GET } from "@/app/auth/callback/route";
import { GET as confirm } from "@/app/auth/confirm/route";
import { updatePassword } from "@/app/reset-password/actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  data.set("user_id", "athlete-a");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "athlete-a" } }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe("password recovery", () => {
  it("verifies an emailed token in a new browser without a PKCE cookie", async () => {
    const response = await confirm(new Request("https://gym.example/auth/confirm?token_hash=one-time-token&type=recovery&next=https://other.example"));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "one-time-token", type: "recovery" });
    expect(response.headers.get("location")).toBe("/reset-password");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("allows signup confirmation and rejects unsupported token types", async () => {
    expect((await confirm(new Request("https://gym.example/auth/confirm?token_hash=one-time-token&type=email"))).headers.get("location")).toBe("/login?confirmation=complete");
    auth.verifyOtp.mockClear();
    await confirm(new Request("https://gym.example/auth/confirm?token_hash=one-time-token&type=email_change"));
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("fails closed for expired or reused email tokens", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    expect((await confirm(new Request("https://gym.example/auth/confirm?token_hash=used-token&type=recovery"))).headers.get("location")).toBe("/reset-password?error=invalid-link");
  });
  it("sends a reset link to the token-exchange route without disclosing account existence", async () => {
    const response = await sendPasswordReset(null, form({ email: "athlete@example.com" }));
    expect(response).toEqual({ ok: "If that email has an account, a reset link is on its way." });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("athlete@example.com", { redirectTo: expect.stringMatching(/\/auth\/callback$/) });
  });

  it("reports delivery failures without leaking the provider response", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "private provider details" } });
    expect(await sendPasswordReset(null, form({ email: "athlete@example.com" }))).toEqual({ error: "We couldn't send a reset link right now. Please try again later." });
  });

  it("exchanges a code and redirects only to the password form", async () => {
    const response = await GET(new Request("https://gym.example/auth/callback?code=single-use-code&next=https://other.example"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("single-use-code");
    expect(response.headers.get("location")).toBe("/reset-password");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["", "?error=access_denied", "?code=reused-code"])("handles missing, expired and reused links: %s", async (query) => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid code" } });
    const response = await GET(new Request(`https://gym.example/auth/callback${query}`));
    expect(response.headers.get("location")).toBe("/reset-password?error=invalid-link");
  });

  it("validates password length and confirmation before contacting auth", async () => {
    expect(await updatePassword(null, form({ password: "short", confirm_password: "short" }))).toHaveProperty("error");
    expect(await updatePassword(null, form({ password: "long-enough", confirm_password: "different" }))).toHaveProperty("error");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("requires a verified user, not a client-supplied user id", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect(await updatePassword(null, form({ password: "new-password", confirm_password: "new-password", user_id: "athlete-b" }))).toHaveProperty("error");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("changes the verified user's password, preserves whitespace and signs out globally", async () => {
    await expect(updatePassword(null, form({ password: " new-password ", confirm_password: " new-password " }))).rejects.toThrow("redirect:/login?password=updated");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: " new-password " });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("does not change a different account when another tab switches the browser session", async () => {
    expect(await updatePassword(null, form({ password: "new-password", confirm_password: "new-password", user_id: "athlete-b" }))).toEqual({ error: "Your account changed. Reopen your reset link or request a new one." });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("does not report success when the password update fails", async () => {
    auth.updateUser.mockResolvedValue({ error: { message: "expired recovery" } });
    expect(await updatePassword(null, form({ password: "new-password", confirm_password: "new-password" }))).toHaveProperty("error");
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
