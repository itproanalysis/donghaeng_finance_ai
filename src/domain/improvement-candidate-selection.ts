export const BORROWER_SELECTED_IMPROVEMENT_CANDIDATE =
  "BORROWER_SELECTED_IMPROVEMENT_CANDIDATE" as const;

export const IMPROVEMENT_CANDIDATE_ORIGINS = [
  "CONFIRMED_GOAL",
  "CONFIRMED_ANSWER",
  "CATALOG_SUGGESTION",
] as const;

export type ImprovementCandidateOrigin =
  (typeof IMPROVEMENT_CANDIDATE_ORIGINS)[number];

/**
 * The only borrower-facing candidate fields that may cross the completion
 * command boundary. This is a non-binding interview preference, not a goal,
 * feature, score, approval input, or canonical information value.
 */
export interface AllowlistedImprovementCandidate {
  id: string;
  title: string;
  origin: ImprovementCandidateOrigin;
  sourceInfoCodes: string[];
  evidenceIds: string[];
}

export type BorrowerImprovementChoice =
  | "SKIP"
  | AllowlistedImprovementCandidate;

export interface BorrowerImprovementSelection {
  id: string;
  eventType: typeof BORROWER_SELECTED_IMPROVEMENT_CANDIDATE;
  choice: BorrowerImprovementChoice;
  liveVersion: number;
  selectedAt: string;
}

export interface ImprovementCandidateBasisItem {
  infoCode: string;
  status: string;
  updatedAt: string | null;
  evidenceIds: readonly string[];
  displayValue: string | null;
}

export interface ImprovementCandidateGoalBasis {
  status: string | null;
  title: string | null;
  evidenceIds: readonly string[];
}

const CANDIDATE_TITLES_BY_INFO_CODE: Readonly<Record<string, string>> = {
  monthly_average_sales: "월 매출 흐름 기록하기",
  fixed_operating_costs: "고정 운영비 항목 점검하기",
  confirmed_reservations: "예약·주문 일정 확인하기",
  seasonality_outlook: "계절 수요 변화 기록하기",
  platform_fee_pressure: "플랫폼 비용 변화 기록하기",
  hall_customer_decline: "홀 고객 변화 기록하기",
  repeat_customer_share: "단골 매출 변화 기록하기",
};

const FALLBACK_CANDIDATES: readonly AllowlistedImprovementCandidate[] = [
  {
    id: "catalog-improvement-action",
    title: "한 가지 개선 행동 정하기",
    origin: "CATALOG_SUGGESTION",
    sourceInfoCodes: ["improvement_plan"],
    evidenceIds: [],
  },
  {
    id: "catalog-execution-order",
    title: "실행 준비 순서 정하기",
    origin: "CATALOG_SUGGESTION",
    sourceInfoCodes: ["execution_readiness"],
    evidenceIds: [],
  },
  {
    id: "catalog-sales-log",
    title: "월 매출 흐름 기록하기",
    origin: "CATALOG_SUGGESTION",
    sourceInfoCodes: ["monthly_average_sales"],
    evidenceIds: [],
  },
] as const;

function normalizedIds(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizedCandidate(
  candidate: AllowlistedImprovementCandidate,
): AllowlistedImprovementCandidate {
  return {
    ...candidate,
    title: candidate.title.trim(),
    sourceInfoCodes: normalizedIds(candidate.sourceInfoCodes),
    evidenceIds: normalizedIds(candidate.evidenceIds),
  };
}

function pushCandidate(
  candidates: AllowlistedImprovementCandidate[],
  candidate: AllowlistedImprovementCandidate,
): void {
  const normalized = normalizedCandidate(candidate);
  if (!normalized.title || candidates.some((existing) => existing.title === normalized.title)) {
    return;
  }
  candidates.push(normalized);
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Generates the exact three-card allowlist from one authoritative live
 * snapshot. Both browser presentation and completion validation call this
 * function, so a client cannot substitute a title, provenance, or evidence ID.
 */
export function buildAllowlistedImprovementCandidates(input: {
  informationItems: readonly ImprovementCandidateBasisItem[];
  goal: ImprovementCandidateGoalBasis | null;
}): AllowlistedImprovementCandidate[] {
  const candidates: AllowlistedImprovementCandidate[] = [];

  if (input.goal?.status === "CONFIRMED" && input.goal.title?.trim()) {
    pushCandidate(candidates, {
      id: "confirmed-goal-candidate",
      title: input.goal.title,
      origin: "CONFIRMED_GOAL",
      sourceInfoCodes: [],
      evidenceIds: [...input.goal.evidenceIds],
    });
  }

  const confirmedPlan = input.informationItems.find(
    (item) =>
      item.infoCode === "improvement_plan" &&
      item.status === "CONFIRMED" &&
      Boolean(item.displayValue?.trim()),
  );
  if (confirmedPlan?.displayValue) {
    pushCandidate(candidates, {
      id: "confirmed-improvement-plan-candidate",
      title: confirmedPlan.displayValue,
      origin: "CONFIRMED_ANSWER",
      sourceInfoCodes: [confirmedPlan.infoCode],
      evidenceIds: [...confirmedPlan.evidenceIds],
    });
  }

  const confirmedOperationalItems = input.informationItems
    .filter((item) => item.status === "CONFIRMED" && Boolean(item.displayValue?.trim()))
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
  for (const item of confirmedOperationalItems) {
    const title = CANDIDATE_TITLES_BY_INFO_CODE[item.infoCode];
    if (!title) continue;
    pushCandidate(candidates, {
      id: `confirmed-${item.infoCode}-candidate`,
      title,
      origin: "CONFIRMED_ANSWER",
      sourceInfoCodes: [item.infoCode],
      evidenceIds: [...item.evidenceIds],
    });
    if (candidates.length >= 3) break;
  }

  for (const fallback of FALLBACK_CANDIDATES) {
    if (candidates.length >= 3) break;
    pushCandidate(candidates, fallback);
  }

  return candidates.slice(0, 3);
}

export function improvementCandidateChoicesEqual(
  left: AllowlistedImprovementCandidate,
  right: AllowlistedImprovementCandidate,
): boolean {
  return left.id === right.id &&
    left.title === right.title &&
    left.origin === right.origin &&
    left.sourceInfoCodes.length === right.sourceInfoCodes.length &&
    left.sourceInfoCodes.every((value, index) => value === right.sourceInfoCodes[index]) &&
    left.evidenceIds.length === right.evidenceIds.length &&
    left.evidenceIds.every((value, index) => value === right.evidenceIds[index]);
}

export function isAllowlistedImprovementChoice(
  choice: BorrowerImprovementChoice,
  candidates: readonly AllowlistedImprovementCandidate[],
): boolean {
  return choice === "SKIP" ||
    candidates.some((candidate) => improvementCandidateChoicesEqual(choice, candidate));
}

/** Exact borrower-facing title basis used only by the confirmed plan card. */
export function improvementPlanCandidateDisplayValue(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (plan.kind !== "IMPROVEMENT_PLAN") return null;
  if (plan.planExists === false) return "명시된 개선 계획 없음";
  const firstAction = Array.isArray(plan.actions)
    ? plan.actions.find(
        (action): action is Record<string, unknown> =>
          Boolean(action) && typeof action === "object" && !Array.isArray(action),
      )
    : null;
  const actionText = typeof firstAction?.text === "string"
    ? firstAction.text.trim()
    : "";
  if (actionText) return actionText;
  const problem = typeof plan.problem === "string" ? plan.problem.trim() : "";
  return problem || "개선 계획 있음";
}
