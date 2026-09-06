import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { getAuthService, getInterviewService } from "@/server/service-instance";
import { RecoveryService } from "@/server/recovery-service";
import { getDatabase } from "@/server/database";
import { ApplicationError } from "@/server/errors";
import { SIGNAL_LABELS } from "@/domain/data-review";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    const parameters = new URL(request.url).searchParams;
    const q = (parameters.get("q") ?? "").trim(), offset = Number(parameters.get("offset") ?? 0);
    if (q.length > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ApplicationError(400, "INVALID_REVIEW_FILTER", "조회 조건을 확인해 주세요.");
    const service = getInterviewService(), recovery = new RecoveryService(getDatabase(), service);
    const result = service.listInterviewOperations(principal, { q, offset, limit: 12 });
    return apiSuccess({ ...result, items: result.items.map((item) => {
      const review = service.getDataReview(item.id, principal);
      const intervention = review.snapshotType === "FINAL" ? recovery.get(item.id, principal) : null;
      return { ...item, metrics: review.metrics, signals: review.features.filter((feature) => feature.name in SIGNAL_LABELS && feature.state === "COMPUTED").map((feature) => ({ name: feature.name, interpretation: feature.interpretation })), planSelected: review.selection?.choice === "SKIP" ? "SKIPPED" : review.selection ? "SELECTED" : "PENDING", reviewStatus: intervention?.review.status ?? "PENDING" };
    }) }, 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}
