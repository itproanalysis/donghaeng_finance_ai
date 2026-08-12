import { assertSameOriginMutation } from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readMessageCommand,
  requestIdFor,
} from "@/server/api-response";
import { getAuthService, getInterviewService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const [{ id }, command] = await Promise.all([params, readMessageCommand(request)]);
    return apiSuccess(await getInterviewService().addMessageCommandAsync(id, command, principal), 200, {
      requestId,
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
