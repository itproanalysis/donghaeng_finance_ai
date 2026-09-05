import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService, SESSION_COOKIE_NAME, sessionCookie } from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { assertApplicationAuthenticationAvailable, assertCustomServerAuthenticationConfigured } from "../../src/server/production-auth-policy";
import { reserveReviewUsage } from "../../src/server/public-review";
import { PublicReviewRealtime } from "../../src/server/public-review-realtime";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const environment = {
  NODE_ENV: "production", DONGHAENG_AUTH_MODE: "public-review", DONGHAENG_REVIEW_ISOLATED: "1",
  DONGHAENG_DB_PATH: "/data/review.db", DONGHAENG_APP_ORIGIN: "https://review.example.com",
  DONGHAENG_REVIEW_CLOSES_AT: "2026-09-11T15:00:00.000Z",
};
const now = new Date("2026-09-04T06:00:00Z");
const databases: ReturnType<typeof createInMemoryDatabase>[] = [];
function setup() {
  const db = createInMemoryDatabase(); databases.push(db);
  const auth = new AuthService(db, () => now, environment);
  const fresh = () => auth.startPublicReview(new Request("https://review.example.com"));
  const a = fresh(); const b = fresh();
  if (!("token" in a) || !("token" in b)) throw new Error("Expected fresh tokens");
  const request = (token: string) => new Request("https://review.example.com", { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });
  return { db, auth, a, b, request };
}
afterEach(() => { vi.unstubAllEnvs(); for (const db of databases.splice(0)) db.close(); });

describe("isolated login-free review", () => {
  it("fails closed for shared database, HTTP, E2E and expired configuration", () => {
    expect(() => assertApplicationAuthenticationAvailable(environment)).not.toThrow();
    expect(() => assertCustomServerAuthenticationConfigured({ development: false, hostname: "0.0.0.0", port: 3000, environment })).not.toThrow();
    for (const overrides of [{ DONGHAENG_DB_PATH: "/data/donghaeng-ai.db" }, { DONGHAENG_APP_ORIGIN: "http://review.example.com" }, { DONGHAENG_E2E_AUTH_ALLOW_LOCAL: "1" }]) {
      expect(() => assertApplicationAuthenticationAvailable({ ...environment, ...overrides })).toThrow();
    }
    const { db } = setup();
    expect(() => new AuthService(db, () => new Date("2026-09-12"), environment).startPublicReview(new Request("https://review.example.com"))).toThrow("운영 기간");
  });
  it("isolates browser records, reuses its cookie, never creates an administrator", () => {
    const { db, auth, a, b, request } = setup();
    expect(a.principal.tenantId).not.toBe(b.principal.tenantId);
    expect(a.principal.roles).toEqual(["INTERVIEWER"]);
    expect(auth.startPublicReview(request(a.token)).principal).toEqual(a.principal);
    expect(db.prepare("SELECT count(*) AS n FROM public_review_usage WHERE kind = 'visitor' AND scope LIKE 'review-%'").get()?.n).toBe(2);
    expect(() => auth.bootstrapLocalWorkspace()).toThrow();
    expect(() => auth.login("local@donghaeng.workspace", "irrelevant")).toThrow();
    const service = new InterviewService(new InterviewRepository(db));
    const first = service.createInterview(a.principal);
    expect(() => service.getInterviewSnapshot(first.session.id, b.principal)).toThrow();
    expect(auth.authenticate(request(a.token)).tenantId).toBe(a.principal.tenantId);
    expect(() => auth.authenticate(request(a.token + "tampered"))).toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie(a.token, a.expiresAt)).toContain("HttpOnly; SameSite=Lax;");
    expect(sessionCookie(a.token, a.expiresAt)).toContain("Secure");
  });
  it("atomically persists visitor and global limits; failed reservations don't partially increment", () => {
    const { db, a } = setup();
    reserveReviewUsage(db, "realtime", a.principal.tenantId, 2, environment, now);
    expect(() => reserveReviewUsage(db, "realtime", a.principal.tenantId, 1, environment, now)).toThrow();
    expect(db.prepare("SELECT used FROM public_review_usage WHERE kind = 'realtime' AND scope = 'global' AND period = '2026-09-04'").get()?.used).toBe(2);
    for (let i = 0; i < 4; i++) reserveReviewUsage(db, "realtime", `review-${i}`, 1, environment, now);
    expect(() => reserveReviewUsage(db, "realtime", "review-new-cookie", 1, environment, now)).toThrow();
  });
  it("proxies SDP without exposing a key and reaps persisted calls after manager restart", async () => {
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real-provider-key");
    const { db, a, b } = setup();
    const fetcher = vi.fn(async () => new Response("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111", { headers: { location: "/v1/realtime/calls/rtc_test123" } }));
    const manager = new PublicReviewRealtime(db, fetcher, () => now);
    const call = await manager.connect("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111", "test", a.principal);
    expect(JSON.stringify(call)).not.toContain("sk-");
    await expect(manager.end(call.id, b.principal.tenantId)).rejects.toThrow();
    await expect(manager.connect("v=0\r\nm=audio 9", "test", a.principal)).rejects.toThrow("진행 중");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const hangup = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    await new PublicReviewRealtime(db, hangup, () => new Date(now.getTime() + 601_000)).sweep();
    expect(hangup.mock.calls[0]?.[0]).toContain("rtc_test123/hangup");
    expect(db.prepare("SELECT ended_at FROM public_review_calls WHERE id = ?").get(call.id)?.ended_at).toBeTruthy();
  });
});
