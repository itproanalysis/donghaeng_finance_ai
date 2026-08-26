import type {
  DevV1InfoCode,
  FeatureComputationState,
  GoalNumericStatus,
  GoalStatus,
  InformationStatus,
} from "../../src/domain";

export interface SohoTranscriptTurn {
  currentInfoCode: DevV1InfoCode;
  text: string;
  expectedStatus: InformationStatus;
  expectedExtractedInfoCodes?: readonly DevV1InfoCode[];
}

export interface SohoPrefillFixture {
  infoCode: DevV1InfoCode;
  text: string;
  channels?: readonly string[];
}

export interface SohoExpectedStateTransition {
  infoCode: DevV1InfoCode;
  from: InformationStatus;
  to: InformationStatus;
}

export interface SohoExpectedFeature {
  name: string;
  state: FeatureComputationState;
  raw?: unknown;
  normalized?: number | null;
}

export interface SohoScenarioFixture {
  id: string;
  industry: string;
  requiredList: readonly DevV1InfoCode[];
  prefill?: SohoPrefillFixture;
  transcript: readonly SohoTranscriptTurn[];
  expectedStateTransitions: readonly SohoExpectedStateTransition[];
  expectedFeatures: readonly SohoExpectedFeature[];
  expectedGoal: {
    status: GoalStatus;
    numericStatus: GoalNumericStatus;
  };
  expectedEvaluation: {
    status: "READY" | "NOT_ELIGIBLE";
    gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1";
    overallGrade: "A" | "B" | "C" | "D" | "E" | "UNGRADED";
    approvalDecision: null;
  };
  boundaryTags: readonly string[];
}

export const ALL_DEV_V1_INFO_CODES: readonly DevV1InfoCode[] = [
  "monthly_average_sales",
  "fixed_operating_costs",
  "improvement_plan",
  "execution_readiness",
  "confirmed_reservations",
  "seasonality_outlook",
  "essential_household_expenses",
  "emergency_buffer_months",
];

function transition(
  infoCode: DevV1InfoCode,
  from: InformationStatus,
  to: InformationStatus,
): SohoExpectedStateTransition {
  return { infoCode, from, to };
}

function collect(
  infoCode: DevV1InfoCode,
  from: "ASKING" | "NEEDED" | "CONFLICT",
  to: "CONFIRMED" | "NEEDS_FOLLOWUP",
): SohoExpectedStateTransition[] {
  return [
    ...(from === "CONFLICT" ? [transition(infoCode, "CONFLICT", "ASKING")] : []),
    transition(infoCode, from === "CONFLICT" ? "ASKING" : from, "COLLECTED"),
    transition(infoCode, "COLLECTED", to),
  ];
}

function fixture(
  input: Omit<SohoScenarioFixture, "requiredList" | "expectedEvaluation"> & {
    evaluationStatus?: "READY" | "NOT_ELIGIBLE";
  },
): SohoScenarioFixture {
  const { evaluationStatus = "NOT_ELIGIBLE", ...rest } = input;
  return {
    ...rest,
    requiredList: ALL_DEV_V1_INFO_CODES,
    expectedEvaluation: {
      status: evaluationStatus,
      gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
      overallGrade: evaluationStatus === "READY" ? "A" : "UNGRADED",
      approvalDecision: null,
    },
  };
}

export const SOHO_SCENARIO_FIXTURES: readonly SohoScenarioFixture[] = [
  fixture({
    id: "restaurant-normal",
    industry: "음식점",
    transcript: [
      { currentInfoCode: "monthly_average_sales", text: "최근 3개월 월평균 매출은 4,800만원입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "fixed_operating_costs", text: "임차료와 인건비를 포함한 월 고정 운영비 합계는 2,100만원입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "improvement_plan", text: "저녁 재방문이 낮은 문제를 개선하려고 3개월 동안 예약 고객 쿠폰을 운영하고 POS 재방문 건수로 측정하며 현재 40건에서 목표 60건으로 늘리겠습니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("monthly_average_sales", "ASKING", "CONFIRMED"),
      ...collect("fixed_operating_costs", "NEEDED", "CONFIRMED"),
      ...collect("improvement_plan", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "monthly_average_sales", state: "COMPUTED", raw: { kind: "EXACT", value: 48_000_000 } },
      { name: "fixed_operating_costs", state: "COMPUTED", raw: { kind: "EXACT", value: 21_000_000 } },
      { name: "fixed_cost_ratio", state: "COMPUTED", raw: { kind: "EXACT", value: 21_000_000 / 48_000_000 } },
      { name: "plan_specificity", state: "COMPUTED", normalized: 1 },
    ],
    expectedGoal: { status: "CONFIRMED", numericStatus: "DIRECT" },
    boundaryTags: ["normal", "partial-interview-not-eligible"],
  }),
  fixture({
    id: "cafe-prefill-conflict",
    industry: "카페",
    prefill: {
      infoCode: "monthly_average_sales",
      text: "카드 월평균 매출은 2,100만원입니다.",
      channels: ["CARD"],
    },
    transcript: [
      { currentInfoCode: "monthly_average_sales", text: "전체 채널 월평균 매출은 2,300만원입니다.", expectedStatus: "CONFLICT" },
      { currentInfoCode: "monthly_average_sales", text: "카드 2,100만원에 현금 200만원을 더한 전체 매출 2,300만원이 맞습니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      transition("monthly_average_sales", "ASKING", "COLLECTED"),
      transition("monthly_average_sales", "COLLECTED", "CONFLICT"),
      ...collect("monthly_average_sales", "CONFLICT", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "monthly_average_sales", state: "COMPUTED", raw: { kind: "EXACT", value: 23_000_000 } },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["conflict", "correction", "channel-basis"],
  }),
  fixture({
    id: "online-multi-collection",
    industry: "온라인",
    transcript: [
      {
        currentInfoCode: "monthly_average_sales",
        text: "월평균 매출은 8,000만원이고 고정 운영비 합계는 월 1,200만원이며, 앞으로 4주 확정 주문은 35건입니다.",
        expectedStatus: "CONFIRMED",
        expectedExtractedInfoCodes: [
          "monthly_average_sales",
          "fixed_operating_costs",
          "confirmed_reservations",
        ],
      },
      { currentInfoCode: "seasonality_outlook", text: "향후 석 달 계절성 전망은 지난 2년 여름 주문 기록을 근거로 수요가 늘어날 전망입니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("monthly_average_sales", "ASKING", "CONFIRMED"),
      ...collect("fixed_operating_costs", "NEEDED", "CONFIRMED"),
      ...collect("confirmed_reservations", "NEEDED", "CONFIRMED"),
      ...collect("seasonality_outlook", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "monthly_average_sales", state: "COMPUTED", raw: { kind: "EXACT", value: 80_000_000 } },
      { name: "fixed_cost_ratio", state: "COMPUTED", raw: { kind: "EXACT", value: 0.15 } },
      { name: "confirmed_reservation_count_4w", state: "COMPUTED", raw: { kind: "EXACT", value: 35 } },
      { name: "demand_visibility", state: "COMPUTED" },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["multi-collection", "off-turn-anchor"],
  }),
  fixture({
    id: "beauty-refusal",
    industry: "미용",
    transcript: [
      { currentInfoCode: "essential_household_expenses", text: "월 필수 가계지출 답변을 거부하겠습니다.", expectedStatus: "NEEDS_FOLLOWUP" },
      { currentInfoCode: "essential_household_expenses", text: "생활비 답변을 거부합니다.", expectedStatus: "REFUSED" },
      { currentInfoCode: "emergency_buffer_months", text: "비상자금도 답변을 거부하겠습니다.", expectedStatus: "NEEDS_FOLLOWUP" },
      { currentInfoCode: "emergency_buffer_months", text: "비상자금 답변을 거부합니다.", expectedStatus: "REFUSED" },
    ],
    expectedStateTransitions: [
      transition("essential_household_expenses", "NEEDED", "NEEDS_FOLLOWUP"),
      transition("essential_household_expenses", "NEEDS_FOLLOWUP", "ASKING"),
      transition("essential_household_expenses", "ASKING", "REFUSED"),
      transition("emergency_buffer_months", "NEEDED", "NEEDS_FOLLOWUP"),
      transition("emergency_buffer_months", "NEEDS_FOLLOWUP", "ASKING"),
      transition("emergency_buffer_months", "ASKING", "REFUSED"),
    ],
    expectedFeatures: [
      { name: "essential_living_expense", state: "MISSING" },
      { name: "buffer_months", state: "MISSING" },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["refused", "no-imputation"],
  }),
  fixture({
    id: "academy-range",
    industry: "학원",
    transcript: [
      { currentInfoCode: "monthly_average_sales", text: "학기마다 달라서 월평균 매출은 3,000만원에서 4,000만원 사이입니다.", expectedStatus: "NEEDS_FOLLOWUP" },
      { currentInfoCode: "confirmed_reservations", text: "앞으로 4주 확정 등록은 8건에서 12건 사이입니다.", expectedStatus: "NEEDS_FOLLOWUP" },
    ],
    expectedStateTransitions: [
      ...collect("monthly_average_sales", "ASKING", "NEEDS_FOLLOWUP"),
      ...collect("confirmed_reservations", "NEEDED", "NEEDS_FOLLOWUP"),
    ],
    expectedFeatures: [
      { name: "monthly_average_sales", state: "COMPUTED", raw: { kind: "RANGE", min: 30_000_000, max: 40_000_000 } },
      { name: "confirmed_reservation_count_4w", state: "COMPUTED", raw: { kind: "RANGE", min: 8, max: 12 } },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["range", "followup", "no-midpoint"],
  }),
  fixture({
    id: "lodging-seasonality",
    industry: "숙박",
    transcript: [
      { currentInfoCode: "confirmed_reservations", text: "앞으로 4주 확정 예약은 28건입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "seasonality_outlook", text: "향후 석 달 계절성 전망은 작년 같은 기간 예약 기록과 지역 축제 일정을 근거로 수요가 늘어날 전망입니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("confirmed_reservations", "NEEDED", "CONFIRMED"),
      ...collect("seasonality_outlook", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "confirmed_reservation_count_4w", state: "COMPUTED", raw: { kind: "EXACT", value: 28 } },
      { name: "demand_visibility", state: "COMPUTED" },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["seasonality", "external-basis"],
  }),
  fixture({
    id: "interior-orders",
    industry: "인테리어",
    transcript: [
      { currentInfoCode: "confirmed_reservations", text: "앞으로 4주 안에 계약까지 끝난 확정 수주는 4건입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "execution_readiness", text: "견적서와 장비, 담당 인력을 확보했고 다음 달 첫째 주부터 바로 시작할 준비가 완료됐습니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("confirmed_reservations", "NEEDED", "CONFIRMED"),
      ...collect("execution_readiness", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "confirmed_reservation_count_4w", state: "COMPUTED", raw: { kind: "EXACT", value: 4 } },
      { name: "execution_readiness", state: "COMPUTED", raw: "READY", normalized: 1 },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["contract-supported"],
  }),
  fixture({
    id: "repair-zero",
    industry: "정비",
    transcript: [
      { currentInfoCode: "confirmed_reservations", text: "앞으로 4주 확정 예약은 0건입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "emergency_buffer_months", text: "비상금이 없어서 필수 생활비를 감당할 수 있는 기간은 0개월입니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("confirmed_reservations", "NEEDED", "CONFIRMED"),
      ...collect("emergency_buffer_months", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "confirmed_reservation_count_4w", state: "COMPUTED", raw: { kind: "EXACT", value: 0 } },
      { name: "buffer_months", state: "COMPUTED", raw: { kind: "EXACT", value: 0 } },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["actual-zero", "not-missing"],
  }),
  fixture({
    id: "retail-vague-cost",
    industry: "소매",
    transcript: [
      { currentInfoCode: "fixed_operating_costs", text: "고정 운영비는 월 700만원에서 900만원 정도입니다.", expectedStatus: "NEEDS_FOLLOWUP" },
      { currentInfoCode: "seasonality_outlook", text: "향후 석 달 수요는 좋아질 것 같습니다.", expectedStatus: "NEEDS_FOLLOWUP" },
    ],
    expectedStateTransitions: [
      ...collect("fixed_operating_costs", "NEEDED", "NEEDS_FOLLOWUP"),
      ...collect("seasonality_outlook", "NEEDED", "NEEDS_FOLLOWUP"),
    ],
    expectedFeatures: [
      { name: "fixed_operating_costs", state: "COMPUTED", raw: { kind: "RANGE", min: 7_000_000, max: 9_000_000 } },
      { name: "fixed_cost_ratio", state: "MISSING" },
      { name: "demand_visibility", state: "MISSING" },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["vague", "range", "unsupported-outlook"],
  }),
  fixture({
    id: "transport-household-unknown",
    industry: "운송",
    transcript: [
      { currentInfoCode: "essential_household_expenses", text: "월 필수 가계지출은 잘 모르겠습니다.", expectedStatus: "NEEDS_FOLLOWUP" },
      { currentInfoCode: "essential_household_expenses", text: "확인해도 잘 모르겠습니다.", expectedStatus: "UNAVAILABLE" },
      { currentInfoCode: "emergency_buffer_months", text: "필수 생활비를 몇 달 감당하는지 잘 모르겠습니다.", expectedStatus: "NEEDS_FOLLOWUP" },
      { currentInfoCode: "emergency_buffer_months", text: "아직도 잘 모르겠습니다.", expectedStatus: "UNAVAILABLE" },
    ],
    expectedStateTransitions: [
      transition("essential_household_expenses", "NEEDED", "NEEDS_FOLLOWUP"),
      transition("essential_household_expenses", "NEEDS_FOLLOWUP", "ASKING"),
      transition("essential_household_expenses", "ASKING", "UNAVAILABLE"),
      transition("emergency_buffer_months", "NEEDED", "NEEDS_FOLLOWUP"),
      transition("emergency_buffer_months", "NEEDS_FOLLOWUP", "ASKING"),
      transition("emergency_buffer_months", "ASKING", "UNAVAILABLE"),
    ],
    expectedFeatures: [
      { name: "essential_living_expense", state: "MISSING" },
      { name: "buffer_months", state: "MISSING" },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["unknown", "single-followup", "terminal"],
  }),
  fixture({
    id: "wholesale-large-compound",
    industry: "도매",
    transcript: [
      { currentInfoCode: "monthly_average_sales", text: "최근 3개월 월평균 매출은 2억 3000만원입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "fixed_operating_costs", text: "창고 임차료와 인건비 등 월 고정 운영비 합계는 4,500만원입니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("monthly_average_sales", "ASKING", "CONFIRMED"),
      ...collect("fixed_operating_costs", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "monthly_average_sales", state: "COMPUTED", raw: { kind: "EXACT", value: 230_000_000 } },
      { name: "fixed_cost_ratio", state: "COMPUTED", raw: { kind: "EXACT", value: 45_000_000 / 230_000_000 } },
    ],
    expectedGoal: { status: "UNRESOLVED", numericStatus: "UNCONFIRMED" },
    boundaryTags: ["compound-korean-money", "safe-integer"],
  }),
  fixture({
    id: "new-business-no-history",
    industry: "신규사업",
    transcript: [
      { currentInfoCode: "monthly_average_sales", text: "아직 영업 전이라 매출이 발생하지 않아서 월평균 매출은 0원입니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "improvement_plan", text: "아직 개선 계획은 없습니다.", expectedStatus: "CONFIRMED" },
      { currentInfoCode: "confirmed_reservations", text: "앞으로 4주 확정 주문은 0건입니다.", expectedStatus: "CONFIRMED" },
    ],
    expectedStateTransitions: [
      ...collect("monthly_average_sales", "ASKING", "CONFIRMED"),
      ...collect("improvement_plan", "NEEDED", "CONFIRMED"),
      ...collect("confirmed_reservations", "NEEDED", "CONFIRMED"),
    ],
    expectedFeatures: [
      { name: "monthly_average_sales", state: "COMPUTED", raw: { kind: "EXACT", value: 0 } },
      { name: "self_plan_exists", state: "COMPUTED", raw: false, normalized: 0 },
      { name: "fixed_cost_ratio", state: "MISSING" },
      { name: "confirmed_reservation_count_4w", state: "COMPUTED", raw: { kind: "EXACT", value: 0 } },
      { name: "confirmed_order_value", state: "COMPUTED", raw: { kind: "EXACT", value: 0 } },
    ],
    expectedGoal: { status: "NO_GOAL_STATED", numericStatus: "NOT_APPLICABLE" },
    boundaryTags: ["new-business", "actual-zero", "no-goal-stated"],
  }),
];
