import {
  assertSameOriginMutation,
  clearedSessionCookie,
  sessionCookie,
} from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readJsonObject,
  requestIdFor,
} from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { getAuthService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const body = await readJsonObject(request);
    if (
      typeof body.email !== "string" ||
      !body.email.trim() ||
      body.email.length > 254 ||
      typeof body.password !== "string" ||
      !body.password ||
      body.password.length > 256
    ) {
      throw new ApplicationError(
        400,
        "INVALID_CREDENTIAL_REQUEST",
        "email과 password 문자열이 필요합니다.",
      );
    }
    const session = getAuthService().login(body.email, body.password);
    return apiSuccess(
      { principal: session.principal, expiresAt: session.expiresAt },
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

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    getAuthService().logout(request);
    return apiSuccess(
      { loggedOut: true },
      200,
      {
        requestId,
        headers: { "Set-Cookie": clearedSessionCookie() },
      },
    );
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
