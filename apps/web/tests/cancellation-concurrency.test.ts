import { execSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { withDeadlockRetry } from "@/lib/supabase/transaction-fetch";
import { makeMember, newAthlete, newSession, service } from "../../../supabase/tests/helpers";
import { localEnv } from "./local";

const { Client } = pg;

async function waitFor(check: () => Promise<boolean>) {
  const until = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("Transaction did not reach the expected lock barrier");
    await delay(20);
  }
}

describe("concurrent membership and seat cancellation", () => {
  it.each(["membership", "seat"] as const)("recovers when PostgreSQL aborts the %s transaction", async (victim) => {
    const env = localEnv();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(env.url).hostname);
    const raw = execSync("pnpm exec supabase status -o json", { cwd: new URL("../../..", import.meta.url).pathname, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const status = JSON.parse(raw.slice(raw.indexOf("{")));
    expect(["127.0.0.1", "localhost"]).toContain(new URL(status.DB_URL).hostname);
    const database = new URL(status.DB_URL);
    // The local test barriers set a superuser-only timeout; application roles stay unchanged.
    database.username = "supabase_admin";
    const locks = new Client({ connectionString: database.href });
    const observer = new Client({ connectionString: database.href });
    await locks.connect(); await observer.connect();
    const users: string[] = [];
    let sessionId: string | undefined;
    const pending: Promise<unknown>[] = [];
    const keys = [810001, 810002];
    const attempts = { membership: [] as (string | null)[], seat: [] as (string | null)[] };
    const transport = (operation: keyof typeof attempts) => withDeadlockRetry(env.url, async (input, init) => {
      const response = await fetch(input, init);
      const result = await response.clone().json().catch(() => null);
      attempts[operation].push(result?.code ?? null);
      return response;
    });
    try {
      const athletes = [];
      for (const label of ["seat", "ending", "next", "last"]) {
        const athlete = await newAthlete(`concurrency-${label}`);
        users.push(athlete.id); athletes.push(athlete);
      }
      const memberships = [];
      for (const athlete of athletes) memberships.push(await makeMember(athlete.id, { credits: 3 }));
      const session = await newSession(1);
      sessionId = session.id;
      const bookings = [];
      for (const athlete of athletes) {
        const booked = await athlete.client.rpc("book_class", { p_session: session.id });
        expect(booked.error).toBeNull(); bookings.push(booked.data);
      }
      expect(bookings.map((b) => b.status)).toEqual(["booked", "waitlisted", "waitlisted", "waitlisted"]);

      // Test-only barriers pause the real requests after their first row lock. No production RPC is replaced.
      await observer.query(`
        create or replace function private.test_cancellation_gate() returns trigger
        language plpgsql security definer set search_path = '' as $$
        begin
          if new.id::text = TG_ARGV[0] then
            perform set_config('deadlock_timeout', TG_ARGV[2], true);
            perform pg_advisory_xact_lock(TG_ARGV[1]::bigint);
          end if;
          return new;
        end $$;
        create trigger a_test_membership_gate after update of status on public.memberships
          for each row execute function private.test_cancellation_gate('${memberships[1].id}', '${keys[0]}', '${victim === "membership" ? "50ms" : "10s"}');
        create trigger a_test_seat_gate after update of status on public.bookings
          for each row execute function private.test_cancellation_gate('${bookings[0].id}', '${keys[1]}', '${victim === "seat" ? "50ms" : "10s"}');
      `);
      await locks.query("select pg_advisory_lock($1), pg_advisory_lock($2)", keys);
      const waitingForGate = (key: number) => observer.query("select exists(select 1 from pg_locks where locktype='advisory' and objid=$1 and not granted) as ready", [key]).then((r) => r.rows[0].ready);
      const waitingForRow = (key: number) => observer.query(`select exists(
        select 1 from pg_locks waiting where waiting.locktype='transactionid' and not waiting.granted
        and waiting.pid in (select pid from pg_locks where locktype='advisory' and objid=$1 and granted)
      ) as ready`, [key]).then((r) => r.rows[0].ready);
      const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport("membership") } });
      const token = (await athletes[0].client.auth.getSession()).data.session!.access_token;
      const athlete = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` }, fetch: transport("seat") } });
      const membershipResult = Promise.resolve(admin.from("memberships").update({ status: "cancelled" }).eq("id", memberships[1].id));
      pending.push(membershipResult);
      await Promise.race([waitFor(() => waitingForGate(keys[0])), membershipResult.then((r) => { throw new Error(`Membership request finished before its barrier: ${r.error?.message}`); })]);
      const seatResult = Promise.resolve(athlete.rpc("cancel_booking", { p_booking: bookings[0].id }));
      pending.push(seatResult);
      await Promise.race([waitFor(() => waitingForGate(keys[1])), seatResult.then((r) => { throw new Error(`Seat request finished before its barrier: ${r.error?.message}`); })]);

      const first = victim === "membership" ? keys[1] : keys[0];
      const second = victim === "membership" ? keys[0] : keys[1];
      await locks.query("select pg_advisory_unlock($1)", [first]);
      await waitFor(() => waitingForRow(first));
      await locks.query("select pg_advisory_unlock($1)", [second]);
      expect((await membershipResult).error).toBeNull();
      expect((await seatResult).error).toBeNull();
      expect(attempts[victim]).toEqual(["40P01", null]);
      expect(attempts[victim === "membership" ? "seat" : "membership"]).toEqual([null]);

      for (let i = 0; i < bookings.length; i++) {
        const row = await service().from("bookings").select("status").eq("id", bookings[i].id).single().throwOnError();
        expect(row.data!.status).toBe(["cancelled", "cancelled", "booked", "waitlisted"][i]);
        const balance = await service().from("memberships").select("credits_remaining").eq("id", memberships[i].id).single().throwOnError();
        expect(balance.data!.credits_remaining).toBe([3, 3, 2, 3][i]);
      }
    } finally {
      await locks.query("select pg_advisory_unlock_all()");
      await Promise.allSettled(pending);
      await observer.query(`drop trigger if exists a_test_membership_gate on public.memberships;
        drop trigger if exists a_test_seat_gate on public.bookings;
        drop function if exists private.test_cancellation_gate();`);
      if (sessionId) await service().from("class_sessions").delete().eq("id", sessionId).throwOnError();
      for (const id of users) await service().auth.admin.deleteUser(id);
      await locks.end(); await observer.end();
    }
  }, 60_000);
});
