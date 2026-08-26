import type { PendingMessageCommandView } from "@/components/api-adapter";

export type BorrowerMessageCommandPayload = Pick<
  PendingMessageCommandView,
  | "text"
  | "clientMessageId"
  | "expectedVersion"
  | "currentQuestionInfoCode"
  | "transcriptMetadata"
>;

/**
 * Keeps retries byte-for-byte equivalent at the API command boundary. In
 * particular, a retry must reuse the staged client id, version, question and
 * transcript metadata instead of looking like a new borrower answer.
 */
export function borrowerMessageCommandPayload(
  command: BorrowerMessageCommandPayload,
): BorrowerMessageCommandPayload {
  return {
    text: command.text,
    clientMessageId: command.clientMessageId,
    expectedVersion: command.expectedVersion,
    currentQuestionInfoCode: command.currentQuestionInfoCode,
    transcriptMetadata: command.transcriptMetadata,
  };
}
