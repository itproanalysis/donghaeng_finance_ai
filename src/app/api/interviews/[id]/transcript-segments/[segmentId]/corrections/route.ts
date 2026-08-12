import { assertSameOriginMutation } from "@/server/auth";
import {
  apiFailure,
  apiSuccess,
  readJsonObject,
  requestIdFor,
} from "@/server/api-response";
import { getDatabase } from "@/server/database";
import { ApplicationError } from "@/server/errors";
import { interviewActivityRegistry } from "@/server/interview-activity-registry";
import { getAuthService, getInterviewService } from "@/server/service-instance";
import {
  TranscriptCorrectionService,
  type TranscriptCorrectionCommand,
} from "@/server/transcript-correction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; segmentId: string }>;
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new ApplicationError(
      400,
      "INVALID_CORRECTION_COMMAND",
      `${field} 값이 올바르지 않습니다.`,
      { field },
    );
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new ApplicationError(
      400,
      "INVALID_CORRECTION_COMMAND",
      `${field} 값이 올바르지 않습니다.`,
      { field },
    );
  }
  return trimmed;
}

async function readCorrectionCommand(request: Request): Promise<TranscriptCorrectionCommand> {
  const body = await readJsonObject(request);
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) {
    throw new ApplicationError(
      400,
      "INVALID_EXPECTED_VERSION",
      "expectedVersion은 1 이상의 정수여야 합니다.",
      { field: "expectedVersion" },
    );
  }
  return {
    clientCorrectionId: requiredString(body, "clientCorrectionId", 128),
    expectedVersion: body.expectedVersion as number,
    correctedText: requiredString(body, "correctedText", 5_000),
    reason: requiredString(body, "reason", 1_000),
  };
}

export async function POST(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const [{ id, segmentId }, command] = await Promise.all([
      params,
      readCorrectionCommand(request),
    ]);
    const activity = interviewActivityRegistry.snapshot(id);
    if (activity.activeTurn || activity.finalTranscriptPending) {
      throw new ApplicationError(
        409,
        "CONCURRENCY_CONFLICT",
        "현재 음성 턴이 진행 중입니다. 오디오 턴 마감 후 자막을 정정해주세요.",
        { interviewId: id },
      );
    }
    const result = new TranscriptCorrectionService(getDatabase(), {
      reprocessingHook: (context) =>
        getInterviewService().reprocessTranscriptCorrection(context),
    }).correctTranscriptSegment(id, segmentId, command, principal);
    return apiSuccess(result, 200, { requestId });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
