import { apiFailure, apiSuccess, readJsonObject, requestIdFor } from "@/server/api-response";
import { assertSameOriginMutation } from "@/server/auth";
import { ConsultationDraftService } from "@/server/consultation-draft-service";
import { getDatabase } from "@/server/database";
import { getAuthService } from "@/server/service-instance";
import { ApplicationError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    const { id } = await params;
    return apiSuccess(new ConsultationDraftService(getDatabase()).get(id, principal), 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const [{ id }, body] = await Promise.all([params, readJsonObject(request)]);
    if (Object.keys(body).some((key) => !["expectedRevision", "data"].includes(key))) {
      throw new ApplicationError(400, "INVALID_CONSULTATION_DRAFT", "상담 초안 요청에 알 수 없는 항목이 있습니다.");
    }
    return apiSuccess(new ConsultationDraftService(getDatabase()).save(id, principal, body.expectedRevision as number, body.data), 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}
