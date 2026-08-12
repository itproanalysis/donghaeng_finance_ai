import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { getAuthService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    return apiSuccess(getAuthService().getSession(request), 200, { requestId });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
