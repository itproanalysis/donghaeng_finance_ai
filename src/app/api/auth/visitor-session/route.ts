import { assertSameOriginMutation, sessionCookie } from "@/server/auth";
import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { getAuthService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const session = getAuthService().startPublicReview(request);
    return apiSuccess({ principal: session.principal, expiresAt: session.expiresAt, authMode: "public-review" }, 200, {
      requestId,
      headers: "token" in session ? { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } : {},
    });
  } catch (error) { return apiFailure(error, { requestId }); }
}
