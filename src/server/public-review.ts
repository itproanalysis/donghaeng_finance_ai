import type { DatabaseSync } from "node:sqlite";
import { ApplicationError } from "./errors";

type Environment = Record<string, string | undefined>;
export const REVIEW_CALL_SECONDS = 600;

export function isPublicReviewMode(environment: Environment = process.env): boolean {
  return environment.DONGHAENG_AUTH_MODE === "public-review";
}

export function assertPublicReviewConfiguration(environment: Environment = process.env): void {
  const origin = environment.DONGHAENG_APP_ORIGIN ?? "";
  let validOrigin = false;
  try {
    const url = new URL(origin);
    validOrigin = url.origin === origin && url.protocol === "https:" && !url.username && !url.password;
  } catch { /* Invalid deployment configuration fails closed below. */ }
  if (!validOrigin || environment.DONGHAENG_REVIEW_ISOLATED !== "1" ||
    environment.DONGHAENG_DB_PATH !== "/data/review.db" ||
    !Number.isFinite(Date.parse(environment.DONGHAENG_REVIEW_CLOSES_AT ?? "")) ||
    environment.DONGHAENG_E2E_AUTH_ALLOW_LOCAL === "1") {
    throw new ApplicationError(503, "REVIEW_CONFIGURATION_INVALID", "심사용 서비스 설정을 확인하고 있습니다.");
  }
}

export function assertPublicReviewOpen(environment: Environment = process.env, now = new Date()): void {
  assertPublicReviewConfiguration(environment);
  if (now.getTime() >= Date.parse(environment.DONGHAENG_REVIEW_CLOSES_AT!)) {
    throw new ApplicationError(410, "REVIEW_CLOSED", "공개 심사 운영 기간이 끝났습니다.");
  }
}

export type ReviewUsageKind = "visitor" | "interview" | "ai" | "tts" | "stt" | "realtime";
const LIMITS: Record<ReviewUsageKind, { visitor: number; daily: number; minute: number }> = {
  visitor: { visitor: 1, daily: 300, minute: 20 },
  interview: { visitor: 4, daily: 400, minute: 30 },
  ai: { visitor: 120, daily: 2400, minute: 100 },
  tts: { visitor: 100, daily: 1600, minute: 100 },
  stt: { visitor: 160, daily: 1600, minute: 160 },
  realtime: { visitor: 2, daily: 20, minute: 6 },
};

/** Durable, atomic admission before external work. Failed attempts still count. */
export function reserveReviewUsage(
  database: DatabaseSync, kind: ReviewUsageKind, tenantId: string,
  units = 1, environment: Environment = process.env, now = new Date(),
): void {
  if (!isPublicReviewMode(environment)) return;
  assertPublicReviewOpen(environment, now);
  if (!Number.isSafeInteger(units) || units < 1 || !tenantId.startsWith("review-")) {
    throw new ApplicationError(403, "REVIEW_IDENTITY_REQUIRED", "이 브라우저의 심사 이용 정보를 확인해 주세요.");
  }
  const limit = LIMITS[kind];
  const date = now.toISOString();
  const checks = [
    { scope: "global", period: date.slice(0, 10), limit: limit.daily },
    { scope: "global", period: date.slice(0, 16), limit: limit.minute },
    { scope: tenantId, period: date.slice(0, 10), limit: limit.visitor },
  ];
  // SAVEPOINT is safe both in a caller's transaction and as a standalone write.
  database.exec("SAVEPOINT review_usage;");
  try {
    for (const item of checks) {
      const row = database.prepare("SELECT used FROM public_review_usage WHERE scope = ? AND kind = ? AND period = ?")
        .get(item.scope, kind, item.period);
      if (Number(row?.used ?? 0) + units > item.limit) {
        throw new ApplicationError(429, "REVIEW_USAGE_LIMIT", kind === "realtime"
          ? "오늘 이용 가능한 실시간 통화 횟수에 도달했습니다. 대화 내용은 유지되며 채팅으로 계속할 수 있습니다."
          : "심사 서비스의 안전한 이용을 위해 요청이 잠시 제한되었습니다. 저장된 기록은 그대로 유지됩니다.");
      }
      database.prepare(`INSERT INTO public_review_usage(scope, kind, period, used) VALUES (?, ?, ?, ?)
        ON CONFLICT(scope, kind, period) DO UPDATE SET used = used + excluded.used`)
        .run(item.scope, kind, item.period, units);
    }
    database.exec("RELEASE review_usage;");
  } catch (error) {
    database.exec("ROLLBACK TO review_usage; RELEASE review_usage;");
    throw error;
  }
}
