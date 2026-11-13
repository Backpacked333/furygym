import { setTimeout as delay } from "node:timers/promises";

export function withDeadlockRetry(supabaseUrl: string, fetcher: typeof fetch = fetch): typeof fetch {
  const rest = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    // Only PostgREST owns a complete database transaction. Never replay payments or auth calls.
    if (url.origin !== rest.origin || !url.pathname.startsWith(rest.pathname)
      || (init?.body != null && typeof init.body !== "string")) return fetcher(input, init);

    const request = input instanceof Request ? input.clone() : input;
    const options = init && { ...init, ...(init.headers && { headers: new Headers(init.headers) }) };
    const signal = options?.signal ?? (request instanceof Request ? request.signal : undefined);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const response = await fetcher(request instanceof Request ? request.clone() : request, options);
      if (response.status !== 500 || attempt === 2) return response;
      const error = await response.clone().json().catch(() => null);
      // 40P01 guarantees rollback; a timeout/network failure does not prove a write failed.
      if (error?.code !== "40P01") return response;
      await response.body?.cancel();
      await delay(50 * 2 ** attempt + Math.random() * 50, undefined, { signal: signal ?? undefined });
    }
  };
}
