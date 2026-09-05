import { afterEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "../../src/components/api-adapter";

afterEach(() => vi.unstubAllGlobals());
it("shares one guest bootstrap across parallel first-load me and list calls", async () => {
  let initialized = false;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === "/api/auth/visitor-session") {
      await new Promise(resolve => setTimeout(resolve, 5));
      initialized = true;
      return new Response(JSON.stringify({ data: {}, error: null }));
    }
    return initialized ? new Response(JSON.stringify({ data: { ok: true }, error: null }))
      : new Response(JSON.stringify({ error: { code: "PUBLIC_REVIEW_SESSION_REQUIRED" } }), { status: 401 });
  });
  vi.stubGlobal("fetch", fetcher);
  const responses = await Promise.all([authenticatedFetch("/api/auth/me"), authenticatedFetch("/api/interviews"), authenticatedFetch("/api/interview-evaluations")]);
  expect(responses.every(response => response.ok)).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/auth/visitor-session")).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => url === "/api/auth/bootstrap")).toBe(false);
});
it("returns admission limits directly without retry loops or login redirects", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => String(input) === "/api/auth/visitor-session"
    ? new Response(JSON.stringify({ error: { code: "REVIEW_USAGE_LIMIT" } }), { status: 429 })
    : new Response(JSON.stringify({ error: { code: "PUBLIC_REVIEW_SESSION_REQUIRED" } }), { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  const response = await authenticatedFetch("/api/auth/me");
  expect(response.status).toBe(429);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not replace the visitor cookie when an old 401 arrives after bootstrap completed", async () => {
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
  let slowCalls = 0;
  let initialized = false;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === "/api/auth/visitor-session") {
      initialized = true;
      return Response.json({ data: {}, error: null });
    }
    if (String(input) === "/api/interviews" && slowCalls++ === 0) {
      await slow;
      return Response.json({ error: { code: "PUBLIC_REVIEW_SESSION_REQUIRED" } }, { status: 401 });
    }
    return initialized ? Response.json({ data: { ok: true } })
      : Response.json({ error: { code: "PUBLIC_REVIEW_SESSION_REQUIRED" } }, { status: 401 });
  });
  vi.stubGlobal("fetch", fetcher);
  const lateResponse = authenticatedFetch("/api/interviews");
  expect((await authenticatedFetch("/api/auth/me")).ok).toBe(true);
  releaseSlow();
  expect((await lateResponse).ok).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/auth/visitor-session")).toHaveLength(1);
});

it("explains blocked cookies after one retry without creating repeated guest identities", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => String(input) === "/api/auth/visitor-session"
    ? Response.json({ data: {} })
    : Response.json({ error: { code: "PUBLIC_REVIEW_SESSION_REQUIRED" } }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  const response = await authenticatedFetch("/api/interviews");
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("PUBLIC_REVIEW_COOKIE_REQUIRED");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
