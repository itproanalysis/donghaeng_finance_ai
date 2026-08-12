import { assertSameOriginMutation } from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readCreateInterviewCommand,
  requestIdFor,
} from "@/server/api-response";
import { getAuthService, getInterviewService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const command = await readCreateInterviewCommand(request);
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
