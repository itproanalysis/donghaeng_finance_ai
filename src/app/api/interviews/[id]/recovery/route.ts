import { apiFailure, apiSuccess, readJsonObject, requestIdFor } from "@/server/api-response";
import { assertSameOriginMutation } from "@/server/auth";
import { getAuthService, getInterviewService } from "@/server/service-instance";
import { getDatabase } from "@/server/database";
import { RecoveryService } from "@/server/recovery-service";
import { ApplicationError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    const { id } = await params;
    return apiSuccess(new RecoveryService(getDatabase(), getInterviewService()).get(id, principal), 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}
export async function POST(request: Request, { params }: Context) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const [{ id }, body] = await Promise.all([params, readJsonObject(request)]);
    const { action, ...command } = body;
    const service = new RecoveryService(getDatabase(), getInterviewService());
    const result = action === "SELECT_ACTION" ? service.select(id, principal, command)
      : action === "ADD_EVIDENCE" ? service.addEvidence(id, principal, command)
      : action === "REVIEW" ? service.review(id, principal, command)
      : null;
    if (!result) throw new ApplicationError(400, "INVALID_RECOVERY_ACTION", "지원하지 않는 실행기록 요청입니다.");
    return apiSuccess(result, 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}
