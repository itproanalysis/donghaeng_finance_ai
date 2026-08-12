import {
  apiFailure,
  apiSuccess,
  readJsonObject,
  requestIdFor,
} from "@/server/api-response";
import { assertSameOriginMutation } from "@/server/auth";
import {
  CONSENT_PURPOSES,
  ConsentService,
  type ConsentPurpose,
} from "@/server/consent-service";
import { getDatabase } from "@/server/database";
import { ApplicationError } from "@/server/errors";
import { getAuthService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    const { id } = await params;
    const principal = getAuthService().authenticate(request);
    const consent = new ConsentService(getDatabase());
    const requiredPurpose = new URL(request.url).searchParams.get("require");
    if (requiredPurpose !== null) {
      if (!CONSENT_PURPOSES.includes(requiredPurpose as ConsentPurpose)) {
        throw new ApplicationError(
          400,
          "INVALID_CONSENT_PURPOSE",
          "확인할 동의 목적이 올바르지 않습니다.",
        );
      }
      consent.assertEffectiveConsent(id, requiredPurpose as ConsentPurpose, principal);
    }
    return apiSuccess(consent.list(id, principal), 200, {
      requestId,
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const [{ id }, body] = await Promise.all([params, readJsonObject(request)]);
    if (!CONSENT_PURPOSES.includes(body.purpose as ConsentPurpose)) {
      throw new ApplicationError(400, "INVALID_CONSENT_PURPOSE", "동의 목적이 올바르지 않습니다.");
    }
    if (typeof body.consentVersion !== "string" || typeof body.granted !== "boolean") {
      throw new ApplicationError(400, "INVALID_CONSENT_DECISION", "동의 요청이 올바르지 않습니다.");
    }
    const expiresAt = body.expiresAt;
    if (expiresAt !== null && expiresAt !== undefined && typeof expiresAt !== "string") {
      throw new ApplicationError(400, "INVALID_CONSENT_EXPIRY", "expiresAt 값이 올바르지 않습니다.");
    }
    const decision = new ConsentService(getDatabase()).record(
      id,
      {
        purpose: body.purpose as ConsentPurpose,
        consentVersion: body.consentVersion,
        granted: body.granted,
        expiresAt: typeof expiresAt === "string" ? expiresAt : null,
      },
      principal,
    );
    return apiSuccess(decision, 201, { requestId });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
