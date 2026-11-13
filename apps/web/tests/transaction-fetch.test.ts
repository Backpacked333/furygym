import { describe, expect, it, vi } from "vitest";
import { withDeadlockRetry } from "@/lib/supabase/transaction-fetch";

const base = "https://database.example.invalid";
const url = `${base}/rest/v1/rpc/cancel_booking`;
const deadlock = () => Response.json({ code: "40P01", message: "deadlock detected" }, { status: 500 });

describe("database transaction retries", () => {
  it("replays only rolled-back transactions, retaining method, identity and payload", async () => {
    const calls: Request[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push(new Request(input, init));
      return calls.length < 3 ? deadlock() : Response.json({ status: "cancelled" });
    });
    const response = await withDeadlockRetry(base, fetcher)(url, { method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: '{"p_booking":"fixture"}', cache: "no-store" });
    expect(await response.json()).toEqual({ status: "cancelled" });
    expect(calls).toHaveLength(3);
    for (const request of calls) {
      expect(request.method).toBe("POST");
      expect(request.headers.get("Authorization")).toBe("Bearer fixture");
      expect(await request.text()).toBe('{"p_booking":"fixture"}');
      expect(request.cache).toBe("no-store");
    }
  });

  it("supports a Request body and leaves the final error readable after three attempts", async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(await new Request(input, init).text());
      return deadlock();
    });
    const response = await withDeadlockRetry(base, fetcher)(new Request(url, { method: "POST", body: "same body" }));
    expect(bodies).toEqual(["same body", "same body", "same body"]);
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("40P01");
  });

  it.each(["42501", "23505", "P0001", "PGRST301", "40001"])("does not retry other errors (%s)", async (code) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code }, { status: 500 }));
    expect((await (await withDeadlockRetry(base, fetcher)(url)).json()).code).toBe(code);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([`${base}/auth/v1/token`, `${base}/api/membership`, "https://api.stripe.com/rest/v1/charges"])("never retries outside this PostgREST origin: %s", async (other) => {
    const fetcher = vi.fn<typeof fetch>(async () => deadlock());
    await withDeadlockRetry(base, fetcher)(other, { method: "POST", body: "{}" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not replay ambiguous network failures, malformed errors, or successful writes", async () => {
    const failure = new TypeError("network connection lost");
    const disconnected = vi.fn<typeof fetch>().mockRejectedValue(failure);
    await expect(withDeadlockRetry(base, disconnected)(url, { method: "POST" })).rejects.toBe(failure);
    expect(disconnected).toHaveBeenCalledTimes(1);
    for (const response of [new Response("gateway error", { status: 500 }), Response.json({ code: "40P01" })]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(await withDeadlockRetry(base, fetcher)(url)).toBe(response);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("honors cancellation before a request and during retry backoff", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => { controller.abort(); return deadlock(); });
    await expect(withDeadlockRetry(base, fetcher)(url, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await expect(withDeadlockRetry(base, fetcher)(url, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
