import type { BorrowerImprovementChoice } from "@/domain/improvement-candidate-selection";

export interface BorrowerCompletionAvailability {
  hasLiveSnapshot: boolean;
  currentQuestion: string | null;
  hasPendingCommand: boolean;
  hasBlockingError: boolean;
  isTurnProcessing: boolean;
  isVoiceBusy: boolean;
  isSending: boolean;
}

export type BorrowerCompletionMode = "COMPLETE" | "FORCE_INCOMPLETE";

export const BORROWER_CONFIRMED_INCOMPLETE_REASON =
  "차주가 확인 가능한 범위까지 답변하고 미확인 또는 답변 곤란 항목을 포함해 종료를 확인함";

export interface BorrowerCompletionInformationItem {
  infoCode: string;
  label: string;
  required: boolean;
  status: string;
}

export interface BorrowerCompletionDisposition {
  mode: BorrowerCompletionMode;
  terminalRequiredItems: BorrowerCompletionInformationItem[];
}

/**
 * A missing question is not sufficient evidence that an interview is ready to
 * finish. Realtime persistence and failed snapshot loads can also temporarily
 * leave the UI without a question, so the borrower confirmation must remain
 * hidden until the live snapshot is settled.
 */
export function canOfferBorrowerCompletion(
  input: BorrowerCompletionAvailability,
): boolean {
  return input.hasLiveSnapshot &&
    input.currentQuestion === null &&
    !input.hasPendingCommand &&
    !input.hasBlockingError &&
    !input.isTurnProcessing &&
    !input.isVoiceBusy &&
    !input.isSending;
}

/**
 * Required REFUSED/UNAVAILABLE answers are resolved conversation states but
 * deliberately cannot become evaluation inputs. The borrower may still close
 * the interview after an explicit review; that path creates an INCOMPLETE FINAL
 * record and never creates an evaluation.
 */
export function borrowerCompletionDisposition(
  items: readonly BorrowerCompletionInformationItem[],
): BorrowerCompletionDisposition {
  const terminalRequiredItems = items.filter(
    (item) =>
      item.required &&
      (item.status === "UNAVAILABLE" || item.status === "REFUSED"),
  );
  return {
    mode: terminalRequiredItems.length > 0 ? "FORCE_INCOMPLETE" : "COMPLETE",
    terminalRequiredItems,
  };
}

export function borrowerCompletionCommand(
  expectedVersion: number,
  clientCommandId: string,
  mode: BorrowerCompletionMode,
  improvementChoice?: BorrowerImprovementChoice | null,
) {
  return {
    clientCommandId,
    expectedVersion,
    mode,
    borrowerConfirmed: true,
    reason: mode === "FORCE_INCOMPLETE"
      ? BORROWER_CONFIRMED_INCOMPLETE_REASON
      : null,
    ...(improvementChoice !== undefined ? { improvementChoice } : {}),
  };
}
