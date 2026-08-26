import type { InformationItemView } from "@/components/api-adapter";

export type BorrowerConversationPhaseKey =
  | "CURRENT_STATE"
  | "IMPROVEMENT_INTENT"
  | "FUTURE_OUTLOOK"
  | "HOUSEHOLD_STATE"
  | "REVIEW";

export type BorrowerConversationPhaseState = "DONE" | "CURRENT" | "UPCOMING";

export interface BorrowerConversationPhase {
  key: BorrowerConversationPhaseKey;
  label: string;
  description: string;
  resolved: number;
  total: number;
  state: BorrowerConversationPhaseState;
  stateLabel: "정리됨" | "지금 이야기" | "다음 이야기";
}

export interface BorrowerConversationGuide {
  phases: BorrowerConversationPhase[];
  currentPhaseKey: BorrowerConversationPhaseKey;
  currentStep: number;
  totalSteps: number;
  ariaLabel: string;
}

const PHASE_DEFINITIONS: ReadonlyArray<Pick<
  BorrowerConversationPhase,
  "key" | "label" | "description"
>> = [
  { key: "CURRENT_STATE", label: "지금 사업 모습", description: "매출·비용·고객" },
  { key: "IMPROVEMENT_INTENT", label: "개선 방향", description: "바꾸고 싶은 점" },
  { key: "FUTURE_OUTLOOK", label: "앞으로의 흐름", description: "예약·계획·전망" },
  { key: "HOUSEHOLD_STATE", label: "생활·재무", description: "생활비·비상 여유" },
  { key: "REVIEW", label: "마무리 확인", description: "답변·개선 후보" },
] as const;

function isConversationResolved(item: InformationItemView): boolean {
  return ["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(item.status);
}

function belongsToBorrowerJourney(item: InformationItemView): boolean {
  // Optional signals are collected only when the borrower volunteers a strong
  // anchor. Untouched NEEDED placeholders must not keep the visible journey in
  // step one after every required question has already been resolved.
  return item.required || item.status !== "NEEDED";
}

/**
 * Projects the authoritative information-state machine into a small borrower
 * journey. It does not invent a score or use Claude output: phases move only
 * when server information items are resolved or selected as the next question.
 */
export function buildBorrowerConversationGuide(input: {
  informationItems: readonly InformationItemView[];
  currentQuestionInfoCode: string | null;
}): BorrowerConversationGuide {
  const journeyItems = input.informationItems.filter(belongsToBorrowerJourney);
  const currentItem = journeyItems.find(
    (item) => item.infoCode === input.currentQuestionInfoCode,
  ) ?? null;
  const allResolved = journeyItems.length > 0 &&
    journeyItems.every(isConversationResolved);
  const firstUnresolvedCategory = PHASE_DEFINITIONS
    .filter((phase) => phase.key !== "REVIEW")
    .find((phase) => journeyItems.some(
      (item) => item.category === phase.key && !isConversationResolved(item),
    ))?.key ?? null;
  const currentPhaseKey: BorrowerConversationPhaseKey = currentItem?.category ??
    (allResolved ? "REVIEW" : firstUnresolvedCategory ?? "CURRENT_STATE");

  const phases = PHASE_DEFINITIONS.map((definition): BorrowerConversationPhase => {
    const items = definition.key === "REVIEW"
      ? journeyItems
      : journeyItems.filter((item) => item.category === definition.key);
    const resolved = definition.key === "REVIEW"
      ? (allResolved ? items.length : 0)
      : items.filter(isConversationResolved).length;
    const total = items.length;
    const state: BorrowerConversationPhaseState = definition.key === currentPhaseKey
      ? "CURRENT"
      : total > 0 && resolved === total
        ? "DONE"
        : "UPCOMING";
    return {
      ...definition,
      resolved,
      total,
      state,
      stateLabel: state === "DONE"
        ? "정리됨"
        : state === "CURRENT"
          ? "지금 이야기"
          : "다음 이야기",
    };
  });
  const currentStep = Math.max(
    1,
    phases.findIndex((phase) => phase.key === currentPhaseKey) + 1,
  );
  const currentPhase = phases[currentStep - 1];
  return {
    phases,
    currentPhaseKey,
    currentStep,
    totalSteps: phases.length,
    ariaLabel: `인터뷰 이야기 순서 ${currentStep}/${phases.length}, ${currentPhase.label}`,
  };
}
