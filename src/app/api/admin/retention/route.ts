import { assertSameOriginMutation } from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readJsonObject,
  requestIdFor,
} from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { getAuthService, getRetentionService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    if (!principal.roles.includes("ADMIN")) {
      throw new ApplicationError(403, "ADMIN_REQUIRED", "관리자 권한이 필요합니다.");
    }
    const body = await readJsonObject(request);
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      throw new ApplicationError(400, "INVALID_DRY_RUN", "dryRun은 boolean이어야 합니다.");
    }
    return apiSuccess(getRetentionService().enforce(body.dryRun !== false), 200, {
      requestId,
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
