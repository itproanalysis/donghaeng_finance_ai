import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "./errors";
import { openAIRealtimeSessionConfig } from "./openai-realtime-session";
import { REVIEW_CALL_SECONDS, reserveReviewUsage } from "./public-review";
import type { Principal } from "./auth";

const CALL_ENDPOINT = "https://api.openai.com/v1/realtime/calls";

/** No provider credential leaves the server. Deadlines survive app restarts. */
export class PublicReviewRealtime {
  constructor(private readonly database: DatabaseSync, private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()) {}

  async connect(sdp: string, interviewId: string, principal: Principal) {
    if (!sdp.startsWith("v=0") || sdp.length > 65_536 || !sdp.includes("m=audio")) {
      throw new ApplicationError(400, "INVALID_REALTIME_OFFER", "음성 연결 요청이 올바르지 않습니다.");
    }
    const key = this.apiKey();
    const id = randomUUID();
    const now = this.now();
    const deadline = new Date(Math.min(now.getTime() + REVIEW_CALL_SECONDS * 1000,
      Date.parse(process.env.DONGHAENG_REVIEW_CLOSES_AT!))).toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      // Unknown upstream outcomes remain quarantined for the provider's maximum
      // session lifetime. Retrying must not create unbounded orphan calls.
      const active = this.database.prepare(`SELECT tenant_id FROM public_review_calls WHERE ended_at IS NULL
        AND created_at > ?`).all(new Date(now.getTime() - 61 * 60_000).toISOString());
      if (active.length >= 4 || active.some((row) => row.tenant_id === principal.tenantId)) {
        throw new ApplicationError(429, "REVIEW_CALL_BUSY", "진행 중인 통화가 있습니다. 통화를 종료한 뒤 다시 연결하거나 채팅으로 이어가 주세요.");
      }
      reserveReviewUsage(this.database, "realtime", principal.tenantId, 1, process.env, now);
      this.database.prepare(`INSERT INTO public_review_calls(id, tenant_id, interview_id, created_at, deadline)
        VALUES (?, ?, ?, ?, ?)`).run(id, principal.tenantId, interviewId, now.toISOString(), deadline);
      this.database.exec("COMMIT;");
    } catch (error) { this.database.exec("ROLLBACK;"); throw error; }

    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(openAIRealtimeSessionConfig().session));
    let response: Response;
    try {
      response = await this.fetchImpl(CALL_ENDPOINT, {
        method: "POST", headers: { Authorization: `Bearer ${key}`,
          "OpenAI-Safety-Identifier": createHash("sha256").update(principal.userId).digest("hex") },
        body: form, signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ApplicationError(502, "REVIEW_VOICE_UNAVAILABLE", "통화 연결을 확인하지 못했습니다. 채팅을 이용하거나 잠시 후 다시 시도해 주세요.");
    }
    if (!response.ok) {
      this.database.prepare("UPDATE public_review_calls SET ended_at = ? WHERE id = ?").run(this.now().toISOString(), id);
      throw new ApplicationError(response.status === 429 ? 429 : 502, "REVIEW_VOICE_UNAVAILABLE", "음성 서비스가 현재 연결을 받을 수 없습니다. 채팅으로 계속할 수 있습니다.");
    }
    const providerId = response.headers.get("location")?.split("/").pop() ?? "";
    if (!/^rtc_[A-Za-z0-9_-]{1,200}$/.test(providerId)) {
      throw new ApplicationError(502, "REVIEW_VOICE_INVALID_RESPONSE", "통화 종료 제어를 확인하지 못해 연결하지 않았습니다.");
    }
    this.database.prepare("UPDATE public_review_calls SET provider_call_id = ? WHERE id = ?").run(providerId, id);
    try {
      const answer = await response.text();
      if (!answer.startsWith("v=0") || answer.length > 65_536) throw new Error("invalid SDP");
      return { id, sdp: answer, deadline };
    } catch {
      await this.end(id, principal.tenantId);
      throw new ApplicationError(502, "REVIEW_VOICE_INVALID_RESPONSE", "통화 연결 정보를 확인하지 못했습니다.");
    }
  }

  async end(id: string, tenantId: string): Promise<void> {
    const row = this.database.prepare("SELECT provider_call_id, ended_at FROM public_review_calls WHERE id = ? AND tenant_id = ?").get(id, tenantId);
    if (!row) throw new ApplicationError(404, "NOT_FOUND", "통화를 찾을 수 없습니다.");
    if (row.ended_at) return;
    if (typeof row.provider_call_id !== "string") {
      throw new ApplicationError(409, "REVIEW_CALL_PENDING", "통화 연결 상태를 확인하고 있습니다.");
    }
    const response = await this.fetchImpl(`${CALL_ENDPOINT}/${row.provider_call_id}/hangup`, {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey()}` }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new ApplicationError(502, "REVIEW_HANGUP_PENDING", "통화 종료를 확인하고 있습니다.");
    }
    this.database.prepare("UPDATE public_review_calls SET ended_at = ? WHERE id = ?").run(this.now().toISOString(), id);
  }

  async sweep(endAll = false): Promise<void> {
    const rows = this.database.prepare(`SELECT id, tenant_id FROM public_review_calls
      WHERE ended_at IS NULL AND provider_call_id IS NOT NULL AND (? = 1 OR deadline <= ?)`).all(endAll ? 1 : 0, this.now().toISOString());
    await Promise.all(rows.map(async (row) => {
      try { await this.end(String(row.id), String(row.tenant_id)); }
      catch { console.warn("[public-review] Call termination pending; next sweep will retry."); }
    }));
  }

  private apiKey(): string {
    const key = process.env.OPENAI_API_KEY?.trim() ?? "";
    if (!key.startsWith("sk-") || /\s/.test(key) || key.length > 2048) {
      throw new ApplicationError(503, "REVIEW_VOICE_NOT_CONFIGURED", "음성 서비스 연결을 준비하고 있습니다.");
    }
    return key;
  }
}
