import type { InformationItem, NextQuestion } from "./interview";

const PRIORITY_WEIGHT = { P0: 0, P1: 1, P2: 2 } as const;
const CATEGORY_PHASE = {
  CURRENT_STATE: 0,
  IMPROVEMENT_INTENT: 1,
  FUTURE_OUTLOOK: 2,
  HOUSEHOLD_STATE: 3,
} as const;

export interface QuestionSelectionContext {
  lastCategory?: InformationItem["category"] | null;
  askedCounts?: Readonly<Record<string, number>>;
  preferredInfoCodes?: readonly string[];
}

const NATURAL_QUESTION_BRIDGES: Readonly<Record<string, readonly string[]>> = {
  monthly_average_sales: ["fixed_operating_costs"],
  fixed_operating_costs: ["monthly_average_sales", "improvement_plan"],
  platform_fee_pressure: ["improvement_plan"],
  hall_customer_decline: ["improvement_plan"],
  repeat_customer_share: ["improvement_plan"],
  improvement_plan: ["execution_readiness"],
  execution_readiness: ["confirmed_reservations"],
  confirmed_reservations: ["seasonality_outlook"],
  essential_household_expenses: ["emergency_buffer_months"],
};

export function preferredQuestionInfoCodesAfterAnswer(
  answeredInfoCode: string | null,
): readonly string[] {
  return answeredInfoCode ? NATURAL_QUESTION_BRIDGES[answeredInfoCode] ?? [] : [];
}

/**
 * Builds a deterministic continuity hint after an answered item. The hint can
 * only reorder candidates that already passed the server's required/optional,
 * dependency, household-last, conflict and follow-up boundaries.
 */
export function questionSelectionContextAfterAnswer(
  items: readonly InformationItem[],
  answeredInfoCode: string | null,
  context: QuestionSelectionContext = {},
): QuestionSelectionContext {
  const answered = answeredInfoCode
    ? items.find((item) => item.infoCode === answeredInfoCode)
    : null;
  const preferredInfoCodes = [
    ...preferredQuestionInfoCodesAfterAnswer(answeredInfoCode),
    ...(context.preferredInfoCodes ?? []),
  ].filter((infoCode, index, all) => all.indexOf(infoCode) === index);

  return {
    ...context,
    lastCategory: context.lastCategory ?? answered?.category ?? null,
    preferredInfoCodes,
  };
}

function dependenciesReady(item: InformationItem, allItems: InformationItem[]): boolean {
  return item.dependencies.every((dependency) => {
    const dependencyItem = allItems.find((candidate) => candidate.infoCode === dependency);
    return dependencyItem?.status === "CONFIRMED" || dependencyItem?.status === "NOT_APPLICABLE";
  });
}

function questionForItem(item: InformationItem): NextQuestion {
  return {
    infoCode: item.infoCode,
    text:
      item.status === "NEEDS_FOLLOWUP"
        ? item.followupQuestion ?? item.question
        : item.status === "CONFLICT"
          ? `기존 자료와 차이가 있습니다. ${item.label}의 산정 기준을 확인해 주세요.`
          : item.question,
    reason:
      item.status === "NEEDS_FOLLOWUP"
        ? "FOLLOWUP"
        : item.status === "CONFLICT"
          ? "CONFLICT"
          : "PRIORITY",
  };
}

/**
 * Returns the small server-owned set an adaptive phrasing model may choose
 * from. Policy boundaries are hard filters, not prompt suggestions:
 * conflict/follow-up are singleton locks, optional NEEDED signals are never
 * unsolicited, household questions wait until the business phases are done,
 * and dependencies must already be resolved. Phase and priority are ordering
 * boosts for normal required questions so the model still receives a useful
 * bounded choice rather than a disguised single deterministic answer.
 */
export function selectEligibleNextQuestions(
  items: InformationItem[],
  currentInfoCode: string | null = null,
  context: QuestionSelectionContext = {},
  limit = 3,
): NextQuestion[] {
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.max(1, Math.min(3, limit))
    : 3;
  const current = currentInfoCode
    ? items.find((item) => item.infoCode === currentInfoCode)
    : undefined;

  if (current?.status === "ASKING") {
    return [{ infoCode: current.infoCode, text: current.question, reason: "PRIORITY" }];
  }
  if (current?.status === "NEEDS_FOLLOWUP") {
    return [{
      infoCode: current.infoCode,
      text: current.followupQuestion ?? `앞서 말씀하신 ${current.label}을(를) 조금 더 구체적으로 알려주세요.`,
      reason: "FOLLOWUP",
    }];
  }
  if (current?.status === "CONFLICT") {
    return [{
      infoCode: current.infoCode,
      text: `기존 자료와 차이가 있습니다. ${current.label}의 기준 기간과 포함된 매출 채널을 확인해 주세요.`,
      reason: "CONFLICT",
    }];
  }

  const preferred = context.preferredInfoCodes ?? [];
  const sortCandidates = (left: InformationItem, right: InformationItem): number => {
    const leftPreferred = preferred.indexOf(left.infoCode);
    const rightPreferred = preferred.indexOf(right.infoCode);
    const leftPreferenceRank = leftPreferred < 0 ? Number.MAX_SAFE_INTEGER : leftPreferred;
    const rightPreferenceRank = rightPreferred < 0 ? Number.MAX_SAFE_INTEGER : rightPreferred;
    if (leftPreferenceRank !== rightPreferenceRank) {
      return leftPreferenceRank - rightPreferenceRank;
    }

    const phaseDifference = CATEGORY_PHASE[left.category] - CATEGORY_PHASE[right.category];
    if (phaseDifference !== 0) return phaseDifference;

    const priorityDifference = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    if (priorityDifference !== 0) return priorityDifference;

    const leftBurden = context.askedCounts?.[left.infoCode] ?? 0;
    const rightBurden = context.askedCounts?.[right.infoCode] ?? 0;
    if (leftBurden !== rightBurden) return leftBurden - rightBurden;

    const leftContinuity = context.lastCategory === left.category ? 0 : 1;
    const rightContinuity = context.lastCategory === right.category ? 0 : 1;
    if (leftContinuity !== rightContinuity) return leftContinuity - rightContinuity;

    return left.infoCode.localeCompare(right.infoCode);
  };

  const candidates = items
    // Optional acceptance signals are derived opportunistically from strong
    // borrower anchors. Untouched NEEDED signals must never become unsolicited
    // prompts, while a resulting conflict/follow-up is resolved before moving
    // on so volunteered evidence is not left ambiguous.
    .filter((item) => item.required || item.status !== "NEEDED")
    .filter((item) => ["NEEDED", "NEEDS_FOLLOWUP", "CONFLICT"].includes(item.status))
    .filter((item) => dependenciesReady(item, items));
  if (candidates.length === 0) return [];

  const conflicts = candidates.filter((item) => item.status === "CONFLICT");
  if (conflicts.length > 0) {
    return [questionForItem(conflicts.sort(sortCandidates)[0]!)];
  }

  const followups = candidates.filter((item) => item.status === "NEEDS_FOLLOWUP");
  if (followups.length > 0) {
    return [questionForItem(followups.sort(sortCandidates)[0]!)];
  }

  let normal = candidates.filter((item) => item.status === "NEEDED");
  const nonHousehold = normal.filter((item) => item.category !== "HOUSEHOLD_STATE");
  if (nonHousehold.length > 0) normal = nonHousehold;

  return normal
    .sort(sortCandidates)
    .slice(0, boundedLimit)
    .map(questionForItem);
}

export function selectNextQuestion(
  items: InformationItem[],
  currentInfoCode: string | null = null,
  context: QuestionSelectionContext = {},
): NextQuestion | null {
  return selectEligibleNextQuestions(items, currentInfoCode, context, 1)[0] ?? null;
}
