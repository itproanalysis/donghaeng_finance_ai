import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { getModelingCase } from "@/server/modeling-demo";

export const runtime = "nodejs";
export const dynamic = "force-static";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  const { caseId } = await params;
  const item = getModelingCase(caseId);
  if (!item) {
    return apiFailure(
      new ApplicationError(404, "MODELING_CASE_NOT_FOUND", "지원하는 모델링 사례가 아닙니다."),
      { requestId },
    );
  }
  const response = apiSuccess(item, 200, { requestId });
  response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  response.headers.set("Vary", "Accept-Encoding");
  return response;
}
