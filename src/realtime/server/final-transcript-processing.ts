import { StreamingSttError } from "./stt-adapter";

export type PersistedTranscriptProcessingStatus =
  | "APPLIED"
  | "RETRYABLE_FAILURE"
  | "NON_RETRYABLE_FAILURE";

export interface PersistedTranscriptProcessingResult {
  processingStatus: PersistedTranscriptProcessingStatus;
  processingCode: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * The internal message route is an authority boundary just like an external
 * provider. Missing or future processing states must never be interpreted as
 * APPLIED because that would let the browser advance past an unverified turn.
 */
export function readPersistedTranscriptProcessing(
  messageResult: unknown,
): PersistedTranscriptProcessingResult {
  const root = record(messageResult);
  const processing = record(root?.processing);
  const status = processing?.status;
  const code = processing?.code;
  if (
    !["APPLIED", "RETRYABLE_FAILURE", "NON_RETRYABLE_FAILURE"].includes(
      String(status),
    ) ||
    !(code === null || (typeof code === "string" && code.length > 0))
  ) {
    throw new StreamingSttError(
      "TURN_PROCESSING_STATUS_INVALID",
      "저장된 음성 답변의 처리 상태를 확인하지 못했습니다. 최신 인터뷰 상태를 다시 확인해 주세요.",
      true,
    );
  }
  return {
    processingStatus: status as PersistedTranscriptProcessingStatus,
    processingCode: code as string | null,
  };
}
