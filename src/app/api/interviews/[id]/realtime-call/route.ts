import { assertSameOriginMutation } from "@/server/auth";
import { apiFailure, apiSuccess, readJsonObject, requestIdFor } from "@/server/api-response";
import { ConsentService } from "@/server/consent-service";
import { getDatabase } from "@/server/database";
import { ApplicationError } from "@/server/errors";
import { isPublicReviewMode } from "@/server/public-review";
import { PublicReviewRealtime } from "@/server/public-review-realtime";
import { getAuthService, getInterviewService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
interface Context { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Context) {
  const requestId = requestIdFor(request);
  try {
    if (!isPublicReviewMode()) throw new ApplicationError(404, "NOT_FOUND", "지원되지 않는 요청입니다.");
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const { id } = await params;
    getInterviewService().getInterviewSnapshot(id, principal);
    const consent = new ConsentService(getDatabase());
    consent.assertEffectiveConsent(id, "MICROPHONE_INTERVIEW", principal);
    consent.assertEffectiveConsent(id, "CLOUD_AI_PROCESSING", principal);
    const body = await readJsonObject(request);
    if (typeof body.sdp !== "string" || Object.keys(body).length !== 1) throw new ApplicationError(400, "INVALID_REALTIME_OFFER", "음성 연결 요청이 올바르지 않습니다.");
    return apiSuccess(await new PublicReviewRealtime(getDatabase()).connect(body.sdp, id, principal), 201, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}

export async function DELETE(request: Request, { params }: Context) {
  const requestId = requestIdFor(request);
  try {
    if (!isPublicReviewMode()) throw new ApplicationError(404, "NOT_FOUND", "지원되지 않는 요청입니다.");
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const { id } = await params;
    getInterviewService().getInterviewSnapshot(id, principal);
    const body = await readJsonObject(request);
    if (typeof body.callId !== "string" || body.callId.length > 128) throw new ApplicationError(400, "INVALID_REALTIME_CALL", "통화 정보가 올바르지 않습니다.");
    await new PublicReviewRealtime(getDatabase()).end(body.callId, principal.tenantId);
    return apiSuccess({ ended: true }, 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}
