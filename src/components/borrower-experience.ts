import type {
  EvidenceView,
  GoalView,
  InformationItemView,
  LiveFeatureView,
} from "@/components/api-adapter";

export type BusinessMapAxisKey =
  | "SALES"
  | "COSTS"
  | "CUSTOMERS"
  | "EXECUTION"
  | "OUTLOOK"
  | "HOUSEHOLD";

export interface BusinessMapAxis {
  key: BusinessMapAxisKey;
  label: string;
  infoCodes: readonly string[];
  resolved: number;
  total: number;
  completionPercent: number;
  stateLabel: "대화 전" | "이야기 중" | "정리됨" | "해당 없음";
}

export interface GroundedInterviewInsight {
  infoCode: string;
  label: string;
  displayValue: string;
  text: string;
}

export interface ImprovementBoardLane {
  key: "CURRENT" | "DIRECTION" | "READINESS";
  label: string;
  value: string | null;
  sourceLabel: "확인된 답변" | "확인된 목표" | null;
}

export interface BorrowerQuickChoice {
  id: string;
  label: string;
  statement: string;
}

export type BorrowerQuestionTone = "STANDARD" | "FOLLOWUP" | "CONFLICT" | "OPTIONAL";

export interface BorrowerQuestionPresentation {
  tone: BorrowerQuestionTone;
  label: string | null;
  helper: string | null;
}

export interface BorrowerExperienceProjection {
  axes: BusinessMapAxis[];
  radarPoints: string;
  insight: GroundedInterviewInsight | null;
  improvementBoard: ImprovementBoardLane[];
  quickChoices: BorrowerQuickChoice[];
  questionPresentation: BorrowerQuestionPresentation;
}

interface BorrowerExperienceInput {
  informationItems: readonly InformationItemView[];
  features: readonly LiveFeatureView[];
  evidence: readonly EvidenceView[];
  currentQuestionInfoCode: string | null;
  questionReason: string | null;
  goal: GoalView | null;
}

const BUSINESS_MAP_AXES: ReadonlyArray<Pick<BusinessMapAxis, "key" | "label" | "infoCodes">> = [
  { key: "SALES", label: "매출", infoCodes: ["monthly_average_sales"] },
  { key: "COSTS", label: "비용", infoCodes: ["fixed_operating_costs", "platform_fee_pressure"] },
  { key: "CUSTOMERS", label: "고객", infoCodes: ["hall_customer_decline", "repeat_customer_share"] },
  { key: "EXECUTION", label: "실행", infoCodes: ["execution_readiness"] },
  { key: "OUTLOOK", label: "계획·전망", infoCodes: ["improvement_plan", "confirmed_reservations", "seasonality_outlook"] },
  { key: "HOUSEHOLD", label: "생활·재무", infoCodes: ["essential_household_expenses", "emergency_buffer_months"] },
] as const;

const RADAR_ANCHORS = [
  [50, 7],
  [88, 28],
  [88, 72],
  [50, 93],
  [12, 72],
  [12, 28],
] as const;

const IMPROVEMENT_PLAN_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "sales-growth",
    label: "매출 늘리기",
    statement: "매출을 늘리는 계획부터 세우고 싶어요.",
  },
  {
    id: "cost-reduction",
    label: "비용 줄이기",
    statement: "고정비와 수수료를 줄이는 계획부터 세우고 싶어요.",
  },
  {
    id: "repeat-customers",
    label: "재방문 늘리기",
    statement: "재방문 고객을 늘리는 계획부터 세우고 싶어요.",
  },
  {
    id: "offer-improvement",
    label: "상품·서비스 개선",
    statement: "메뉴나 상품, 서비스를 개선하는 계획부터 세우고 싶어요.",
  },
  {
    id: "not-decided",
    label: "아직 정하지 못함",
    statement: "아직 구체적인 개선 계획을 정하지 못했어요.",
  },
] as const;

const EXECUTION_READINESS_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "ready",
    label: "바로 시작 가능",
    statement: "인력과 예산, 일정까지 준비되어 바로 시작할 수 있어요.",
  },
  {
    id: "partial",
    label: "일부만 준비",
    statement: "인력이나 예산 중 일부만 준비했고 아직 부족한 부분이 있어요.",
  },
  {
    id: "not-started",
    label: "아직 준비 전",
    statement: "아직 준비하지 못했어요.",
  },
  {
    id: "prefer-not-to-answer",
    label: "답하기 어려움",
    statement: "지금은 실행 준비에 대해 답변하기 어려워요.",
  },
] as const;

const FOLLOWUP_BOUNDARY_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "followup-unknown",
    label: "잘 모르겠어요",
    statement: "한 번 더 생각해 봐도 이 내용은 잘 모르겠어요.",
  },
  {
    id: "followup-refused",
    label: "답하기 어려워요",
    statement: "이 내용은 답변하기 어려워요.",
  },
] as const;

const OPTIONAL_BOUNDARY_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "optional-skip",
    label: "이 질문은 건너뛸게요",
    statement: "이 내용은 답변하기 어려워요.",
  },
] as const;

const RESERVATION_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "reservation-none",
    label: "확정된 건 없음",
    statement: "앞으로 4주 안에 확정된 예약이나 주문은 0건입니다.",
  },
  {
    id: "reservation-unknown",
    label: "있지만 건수는 모름",
    statement: "확정된 예약이나 주문은 있지만 정확한 건수는 잘 모르겠어요.",
  },
] as const;

const SEASONALITY_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "outlook-up",
    label: "늘 것 같아요",
    statement: "앞으로 3개월은 손님이나 주문이 평소보다 늘 것 같아요.",
  },
  {
    id: "outlook-flat",
    label: "비슷할 것 같아요",
    statement: "앞으로 3개월은 손님이나 주문이 평소와 비슷할 것 같아요.",
  },
  {
    id: "outlook-down",
    label: "줄 것 같아요",
    statement: "앞으로 3개월은 손님이나 주문이 평소보다 줄 것 같아요.",
  },
  {
    id: "outlook-unknown",
    label: "아직 모르겠어요",
    statement: "앞으로 3개월의 손님이나 주문 흐름은 아직 잘 모르겠어요.",
  },
] as const;

const SENSITIVE_BOUNDARY_CHOICES: readonly BorrowerQuickChoice[] = [
  {
    id: "sensitive-unknown",
    label: "정확히 모르겠어요",
    statement: "이 내용은 정확히 잘 모르겠어요.",
  },
  {
    id: "sensitive-refused",
    label: "답하기 어려워요",
    statement: "이 내용은 답변하기 어려워요.",
  },
] as const;

function isConversationResolved(item: InformationItemView): boolean {
  return item.status === "CONFIRMED" ||
    item.status === "UNAVAILABLE" ||
    item.status === "REFUSED" ||
    item.status === "NOT_APPLICABLE";
}

function isVisibleConversationItem(item: InformationItemView): boolean {
  return item.required || item.status !== "NEEDED";
}

function confirmedDisplayItems(items: readonly InformationItemView[]) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "CONFIRMED" && Boolean(item.displayValue?.trim()))
    .sort((left, right) => {
      const leftTime = left.item.updatedAt ? Date.parse(left.item.updatedAt) : Number.NaN;
      const rightTime = right.item.updatedAt ? Date.parse(right.item.updatedAt) : Number.NaN;
      const safeLeftTime = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
      const safeRightTime = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
      return safeRightTime - safeLeftTime || right.index - left.index;
    })
    .map(({ item }) => item);
}

function evidenceGroundedConfirmedItems(
  items: readonly InformationItemView[],
  evidence: readonly EvidenceView[],
): InformationItemView[] {
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  return confirmedDisplayItems(items).filter((item) =>
    item.evidenceIds.some((evidenceId) =>
      evidenceById.get(evidenceId)?.infoCode === item.infoCode,
    ),
  );
}

function featureUsesGroundedSources(input: {
  feature: LiveFeatureView;
  sourceItems: readonly InformationItemView[];
  evidence: readonly EvidenceView[];
}): boolean {
  if (input.feature.state !== "COMPUTED" || input.feature.evidenceIds.length === 0) {
    return false;
  }
  const evidenceById = new Map(input.evidence.map((entry) => [entry.id, entry]));
  const sourceEvidenceIds = new Set(
    input.sourceItems.flatMap((item) =>
      item.evidenceIds.filter(
        (evidenceId) => evidenceById.get(evidenceId)?.infoCode === item.infoCode,
      ),
    ),
  );
  const featureEvidenceIds = new Set(input.feature.evidenceIds);
  const exactSourceSet = input.feature.sourceInfoCodes.length === input.sourceItems.length &&
    input.sourceItems.every((item) => input.feature.sourceInfoCodes.includes(item.infoCode));
  const everySourceContributesEvidence = input.sourceItems.every((item) =>
    item.evidenceIds.some((evidenceId) =>
      evidenceById.get(evidenceId)?.infoCode === item.infoCode &&
      featureEvidenceIds.has(evidenceId),
    ),
  );
  return exactSourceSet &&
    everySourceContributesEvidence &&
    input.feature.evidenceIds.every((evidenceId) => sourceEvidenceIds.has(evidenceId));
}

function ratioPercentDisplay(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(?:\s*~\s*(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  const values = [match[1], match[2]].filter((value): value is string => Boolean(value));
  const ratios = values.map(Number);
  if (ratios.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return null;
  }
  const format = (value: number) => new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1,
  }).format(value * 100);
  return `${ratios.map(format).join("~")}%`;
}

function fixedCostRatioInsight(input: {
  groundedItems: readonly InformationItemView[];
  features: readonly LiveFeatureView[];
  evidence: readonly EvidenceView[];
  latestInfoCode: string;
}): GroundedInterviewInsight | null {
  if (!["monthly_average_sales", "fixed_operating_costs"].includes(input.latestInfoCode)) {
    return null;
  }
  const sales = input.groundedItems.find((item) => item.infoCode === "monthly_average_sales");
  const costs = input.groundedItems.find((item) => item.infoCode === "fixed_operating_costs");
  const feature = input.features.find((candidate) => candidate.name === "fixed_cost_ratio");
  if (!sales?.displayValue || !costs?.displayValue || !feature) return null;
  if (!featureUsesGroundedSources({
    feature,
    sourceItems: [sales, costs],
    evidence: input.evidence,
  })) return null;
  const ratio = ratioPercentDisplay(feature.raw);
  if (!ratio) return null;
  return {
    infoCode: input.latestInfoCode,
    label: "매출·고정비 관계",
    displayValue: ratio,
    text: `같은 월 기준의 ${sales.label}(${sales.displayValue})과 ${costs.label}(${costs.displayValue})을 함께 확인했어요. 고정비/매출 비율은 ${ratio}로 계산됐으며, 값에 대한 평가는 아니에요.`,
  };
}

function pairedBusinessSignalInsight(input: {
  groundedItems: readonly InformationItemView[];
  features: readonly LiveFeatureView[];
  evidence: readonly EvidenceView[];
  latestInfoCode: string;
}): GroundedInterviewInsight | null {
  if (!["platform_fee_pressure", "hall_customer_decline"].includes(input.latestInfoCode)) {
    return null;
  }
  const platform = input.groundedItems.find((item) => item.infoCode === "platform_fee_pressure");
  const hall = input.groundedItems.find((item) => item.infoCode === "hall_customer_decline");
  const hallFeature = input.features.find((candidate) => candidate.name === "shock_present");
  if (
    platform?.displayValue !== "플랫폼 비용부담 확인" ||
    hall?.displayValue !== "홀매출 감소 확인" ||
    !hallFeature ||
    hallFeature.normalized !== 1 ||
    !featureUsesGroundedSources({
      feature: hallFeature,
      sourceItems: [hall],
      evidence: input.evidence,
    })
  ) return null;
  return {
    infoCode: input.latestInfoCode,
    label: "함께 확인한 운영 변화",
    displayValue: `${platform.displayValue} · ${hall.displayValue}`,
    text: "사장님 답변에서 플랫폼 비용 부담과 홀 손님 감소를 함께 확인했어요. 두 내용 사이의 원인 관계를 뜻하지 않아요.",
  };
}

export function buildBusinessMap(items: readonly InformationItemView[]): BusinessMapAxis[] {
  const byCode = new Map(items.map((item) => [item.infoCode, item]));
  return BUSINESS_MAP_AXES.map((definition) => {
    const axisItems = definition.infoCodes.flatMap((infoCode) => {
      const item = byCode.get(infoCode);
      return item && isVisibleConversationItem(item) ? [item] : [];
    });
    const resolved = axisItems.filter(isConversationResolved).length;
    const total = axisItems.length;
    const hasActiveConversation = axisItems.some((item) =>
      ["ASKING", "COLLECTED", "NEEDS_FOLLOWUP", "CONFLICT"].includes(item.status),
    );
    const completionPercent = total === 0 ? 0 : Math.round((resolved / total) * 100);
    return {
      ...definition,
      resolved,
      total,
      completionPercent,
      stateLabel: total === 0
        ? "해당 없음"
        : resolved === total
          ? "정리됨"
          : resolved > 0 || hasActiveConversation
            ? "이야기 중"
            : "대화 전",
    };
  });
}

export function businessMapRadarPoints(axes: readonly BusinessMapAxis[]): string {
  return RADAR_ANCHORS.map(([anchorX, anchorY], index) => {
    const ratio = Math.max(0, Math.min(100, axes[index]?.completionPercent ?? 0)) / 100;
    const x = 50 + (anchorX - 50) * ratio;
    const y = 50 + (anchorY - 50) * ratio;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function latestGroundedInsight(
  items: readonly InformationItemView[],
  features: readonly LiveFeatureView[],
  evidence: readonly EvidenceView[],
): GroundedInterviewInsight | null {
  const groundedItems = evidenceGroundedConfirmedItems(items, evidence);
  const latest = groundedItems[0];
  if (!latest?.displayValue) return null;
  const relationInput = {
    groundedItems,
    features,
    evidence,
    latestInfoCode: latest.infoCode,
  };
  const relationalInsight = fixedCostRatioInsight(relationInput) ??
    pairedBusinessSignalInsight(relationInput);
  if (relationalInsight) return relationalInsight;
  return {
    infoCode: latest.infoCode,
    label: latest.label,
    displayValue: latest.displayValue,
    text: `사장님 답변에서 확인한 내용이에요. ${latest.label}: ${latest.displayValue}`,
  };
}

export function buildImprovementBoard(
  items: readonly InformationItemView[],
  goal: GoalView | null,
): ImprovementBoardLane[] {
  const confirmedItems = confirmedDisplayItems(items);
  const currentFacts = confirmedItems
    .filter((item) => item.category === "CURRENT_STATE")
    .slice(0, 2)
    .map((item) => `${item.label} ${item.displayValue}`);
  const plan = confirmedItems.find((item) => item.infoCode === "improvement_plan");
  const readiness = confirmedItems.find((item) => item.infoCode === "execution_readiness");
  const confirmedGoal = goal?.status === "CONFIRMED" && goal.title
    ? goal.title
    : goal?.status === "NO_GOAL_STATED"
      ? "아직 정한 목표 없음"
      : null;

  return [
    {
      key: "CURRENT",
      label: "지금까지 확인한 모습",
      value: currentFacts.length > 0 ? currentFacts.join(" · ") : null,
      sourceLabel: currentFacts.length > 0 ? "확인된 답변" : null,
    },
    {
      key: "DIRECTION",
      label: "사장님의 개선 방향",
      value: confirmedGoal ?? plan?.displayValue ?? null,
      sourceLabel: confirmedGoal
        ? "확인된 목표"
        : plan?.displayValue
          ? "확인된 답변"
          : null,
    },
    {
      key: "READINESS",
      label: "실행 준비",
      value: readiness?.displayValue ?? null,
      sourceLabel: readiness?.displayValue ? "확인된 답변" : null,
    },
  ];
}

export function borrowerQuestionPresentation(input: {
  currentItem: InformationItemView | null;
  questionReason: string | null;
}): BorrowerQuestionPresentation {
  if (input.questionReason === "CONFLICT" || input.currentItem?.status === "CONFLICT") {
    return {
      tone: "CONFLICT",
      label: "서로 다르게 들린 내용을 확인할게요",
      helper: "정답을 요구하는 질문이 아니라, 사장님의 실제 상황을 정확히 기록하기 위한 확인이에요.",
    };
  }
  if (
    input.questionReason === "FOLLOWUP" ||
    input.currentItem?.status === "NEEDS_FOLLOWUP" ||
    input.currentItem?.status === "COLLECTED"
  ) {
    return {
      tone: "FOLLOWUP",
      label: "한 가지만 더 구체적으로 여쭤볼게요",
      helper: "이미 해주신 답변은 저장되어 있어요. 아는 범위까지만 한 번 더 덧붙여 주세요. 이번에도 어렵다면 그대로 기록하고 다음 이야기로 넘어가요.",
    };
  }
  if (input.currentItem && !input.currentItem.required) {
    return {
      tone: "OPTIONAL",
      label: "선택 질문",
      helper: "사업을 더 잘 이해하기 위한 질문이에요. 답하기 어렵다면 편하게 넘어가도 됩니다.",
    };
  }
  if (input.currentItem?.category === "CURRENT_STATE") {
    return {
      tone: "STANDARD",
      label: "지금 사업의 기준점을 맞춰볼게요",
      helper: "정확한 숫자가 아니어도 괜찮아요. 최근 기준과 대략적인 범위를 말씀해 주세요.",
    };
  }
  if (input.currentItem?.category === "IMPROVEMENT_INTENT") {
    return {
      tone: "STANDARD",
      label: "사장님이 중요하게 보는 변화부터 들을게요",
      helper: "정답을 고르는 질문이 아니에요. 실제로 바꾸고 싶은 점을 사장님 방식대로 말씀해 주세요.",
    };
  }
  if (input.currentItem?.category === "FUTURE_OUTLOOK") {
    return {
      tone: "STANDARD",
      label: "확정된 일정과 예상은 나눠서 정리해요",
      helper: "이미 정해진 예약·주문과 사장님의 전망을 구분하면 다음 계획이 더 선명해져요.",
    };
  }
  if (input.currentItem?.category === "HOUSEHOLD_STATE") {
    return {
      tone: "STANDARD",
      label: "생활과 사업이 연결되는 마지막 단계예요",
      helper: "민감할 수 있는 내용이라 정확한 금액 대신 범위로 답하거나, 어렵다고 말씀하셔도 괜찮아요.",
    };
  }
  return { tone: "STANDARD", label: null, helper: null };
}

function quickChoicesForQuestion(
  infoCode: string | null,
  presentation: BorrowerQuestionPresentation,
): BorrowerQuickChoice[] {
  if (presentation.tone === "CONFLICT") return [];
  if (presentation.tone === "FOLLOWUP") return [...FOLLOWUP_BOUNDARY_CHOICES];
  if (presentation.tone === "OPTIONAL") return [...OPTIONAL_BOUNDARY_CHOICES];
  if (infoCode === "improvement_plan") return [...IMPROVEMENT_PLAN_CHOICES];
  if (infoCode === "execution_readiness") return [...EXECUTION_READINESS_CHOICES];
  if (infoCode === "confirmed_reservations") return [...RESERVATION_CHOICES];
  if (infoCode === "seasonality_outlook") return [...SEASONALITY_CHOICES];
  if (["essential_household_expenses", "emergency_buffer_months"].includes(infoCode ?? "")) {
    return [...SENSITIVE_BOUNDARY_CHOICES];
  }
  return [];
}

export function buildBorrowerExperience(input: BorrowerExperienceInput): BorrowerExperienceProjection {
  const currentItem = input.informationItems.find(
    (item) => item.infoCode === input.currentQuestionInfoCode,
  ) ?? null;
  const questionPresentation = borrowerQuestionPresentation({
    currentItem,
    questionReason: input.questionReason,
  });
  const axes = buildBusinessMap(input.informationItems);
  return {
    axes,
    radarPoints: businessMapRadarPoints(axes),
    insight: latestGroundedInsight(input.informationItems, input.features, input.evidence),
    improvementBoard: buildImprovementBoard(input.informationItems, input.goal),
    quickChoices: quickChoicesForQuestion(input.currentQuestionInfoCode, questionPresentation),
    questionPresentation,
  };
}
