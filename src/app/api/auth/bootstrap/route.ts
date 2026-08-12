import { assertSameOriginMutation, sessionCookie } from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readJsonObject,
  requestIdFor,
} from "@/server/api-response";
import { getAuthService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    await readJsonObject(request);
    const session = getAuthService().bootstrapLocalWorkspace();
    return apiSuccess(
      {
        principal: session.principal,
        expiresAt: session.expiresAt,
        bootstrapMode: "LOCAL_WORKSPACE" as const,
      },
      201,
      {
        requestId,
        headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) },
      },
    );
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
