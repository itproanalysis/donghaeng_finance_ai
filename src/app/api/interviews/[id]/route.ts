import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { getAuthService, getInterviewService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    const { id } = await params;
    const principal = getAuthService().authenticate(request);
    return apiSuccess(getInterviewService().getInterviewSnapshot(id, principal), 200, {
      requestId,
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
