import { assertSameOriginMutation } from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readCreateInterviewCommand,
  requestIdFor,
} from "@/server/api-response";
import { getAuthService, getInterviewService } from "@/server/service-instance";
import { ApplicationError } from "@/server/errors";
import type { OperationsFilter } from "@/domain/interview-operations";
import { reserveReviewUsage } from "@/server/public-review";
import { getDatabase } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    const parameters = new URL(request.url).searchParams;
    const q = (parameters.get("q") ?? "").trim();
    const status = parameters.get("status") ?? "ALL";
    const limit = Number(parameters.get("limit") ?? 24);
    const offset = Number(parameters.get("offset") ?? 0);
    if (q.length > 100 || !["ALL", "ACTIVE", "COMPLETE", "INCOMPLETE", "ATTENTION"].includes(status)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
      throw new ApplicationError(400, "INVALID_INTERVIEW_FILTER", "인터뷰 조회 조건이 올바르지 않습니다.");
    }
    return apiSuccess(getInterviewService().listInterviewOperations(principal, { q, status: status as OperationsFilter, limit, offset }), 200, { requestId });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const command = await readCreateInterviewCommand(request);
    reserveReviewUsage(getDatabase(), "interview", principal.tenantId);
    return apiSuccess(
      getInterviewService().createInterview(
        principal,
        command.requiredInformationList,
        command.industryCode,
        command.profile,
      ),
      201,
      { requestId },
    );
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
