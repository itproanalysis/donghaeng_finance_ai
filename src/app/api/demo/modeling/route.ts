import { apiSuccess, requestIdFor } from "@/server/api-response";
import { getModelingIndex } from "@/server/modeling-demo";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET(request: Request) {
  const response = apiSuccess(getModelingIndex(), 200, { requestId: requestIdFor(request) });
  response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  response.headers.set("Vary", "Accept-Encoding");
  return response;
}
