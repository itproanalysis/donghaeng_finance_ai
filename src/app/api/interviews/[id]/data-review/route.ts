import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { getAuthService, getInterviewService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    const { id } = await params;
    return apiSuccess(getInterviewService().getDataReview(id, principal), 200, { requestId });
  } catch (error) { return apiFailure(error, { requestId }); }
}
