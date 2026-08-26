import { assertSameOriginMutation } from "@/server/auth";
import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { ConsentService } from "@/server/consent-service";
import { getDatabase } from "@/server/database";
import { getOpenAIRealtimeSessionIssuer } from "@/server/openai-realtime-session";
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
    const { id } = await params;

    // The snapshot lookup is the tenant-scoped authorization boundary. Both
    // consents are rechecked when a fresh short-lived browser credential is
    // minted, even if the borrower already granted them on the start screen.
    getInterviewService().getInterviewSnapshot(id, principal);
    const consent = new ConsentService(getDatabase());
    consent.assertEffectiveConsent(id, "MICROPHONE_INTERVIEW", principal);
    consent.assertEffectiveConsent(id, "CLOUD_AI_PROCESSING", principal);

    const secret = await getOpenAIRealtimeSessionIssuer().issue({
      interviewId: id,
      userId: principal.userId,
    });
    return apiSuccess(secret, 201, {
      requestId,
      headers: {
        "X-Realtime-Model": secret.model,
      },
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
