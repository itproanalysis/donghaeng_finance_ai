import { describe, expect, it } from "vitest";

import {
  buildBorrowerExperience,
  buildBusinessMap,
  buildImprovementBoard,
  businessMapRadarPoints,
  borrowerQuestionPresentation,
  latestGroundedInsight,
} from "@/components/borrower-experience";
import type {
  EvidenceView,
  GoalView,
  InformationItemView,
  LiveFeatureView,
} from "@/components/api-adapter";
import {
  canonicalQuestionForSpeech,
  presentedQuestion,
} from "@/components/question-voice-playback";
import { DEV_V1_INFORMATION_CATALOG } from "@/domain/information-catalog";

function item(
  infoCode: string,
  overrides: Partial<InformationItemView> = {},
): InformationItemView {
  return {
    id: infoCode,
    infoCode,
    label: infoCode,
    category: "CURRENT_STATE",
    categoryLabel: "현재 사업 상태",
    priority: "P1",
    required: true,
    status: "NEEDED",
    statusLabel: "확인 필요",
    valueState: "MISSING",
    valueStateLabel: "없음",
    displayValue: null,
    verificationLabel: null,
    quality: null,
    updatedAt: null,
    bucket: "needed",
    evidenceIds: [],
    dataQualityScore: null,
    dataQualityGrade: null,
    dataQualitySource: null,
    dataQualityAsOf: null,
    dataQualitySummary: null,
    ...overrides,
  };
}

function evidence(id: string, infoCode: string): EvidenceView {
  return {
    id,
    infoCode,
    kind: "BORROWER_STATEMENT",
    kindLabel: "사장님 답변",
    source: "INTERVIEW",
    transcriptSegmentId: null,
    linkedTranscript: null,
    excerpt: null,
    observedAt: "2026-08-13T10:00:00.000Z",
  };
}

function feature(
  name: string,
  overrides: Partial<LiveFeatureView> = {},
): LiveFeatureView {
  return {
    name,
    domain: "CURRENT_STATE",
    state: "COMPUTED",
    raw: null,
    normalized: null,
    sourceInfoCodes: [],
    evidenceIds: [],
    formula: null,
    reason: null,
    ...overrides,
  };
}

function allMapItems(): InformationItemView[] {
  return [
    item("monthly_average_sales"),
    item("fixed_operating_costs"),
    item("platform_fee_pressure", { required: false }),
    item("hall_customer_decline", { required: false }),
    item("repeat_customer_share", { required: false }),
    item("execution_readiness", { category: "IMPROVEMENT_INTENT" }),
    item("improvement_plan", { category: "IMPROVEMENT_INTENT" }),
    item("confirmed_reservations", { category: "FUTURE_OUTLOOK" }),
    item("seasonality_outlook", { category: "FUTURE_OUTLOOK" }),
    item("essential_household_expenses", { category: "HOUSEHOLD_STATE" }),
    item("emergency_buffer_months", { category: "HOUSEHOLD_STATE" }),
  ];
}

const baseGoal: GoalView = {
  title: null,
  baseline: null,
  target: null,
  period: null,
  unit: null,
  measurementSource: null,
  status: "UNRESOLVED",
  numericStatus: "UNCONFIRMED",
  origin: null,
  context: null,
  behaviorEvent: null,
  evidenceIds: [],
};

describe("borrower experience projection", () => {
  it("builds six completeness axes without turning business facts into a score", () => {
    const items = allMapItems().map((candidate) =>
      candidate.infoCode === "monthly_average_sales"
        ? { ...candidate, status: "CONFIRMED" as const, bucket: "completed" as const }
        : candidate.infoCode === "fixed_operating_costs"
          ? { ...candidate, status: "REFUSED" as const, bucket: "terminal" as const }
          : candidate.infoCode === "platform_fee_pressure"
            ? { ...candidate, status: "ASKING" as const }
            : candidate,
    );

    const axes = buildBusinessMap(items);

    expect(axes).toHaveLength(6);
    expect(axes.find((axis) => axis.key === "SALES")).toMatchObject({
      resolved: 1,
      total: 1,
      completionPercent: 100,
      stateLabel: "정리됨",
    });
    expect(axes.find((axis) => axis.key === "COSTS")).toMatchObject({
      resolved: 1,
      total: 2,
      completionPercent: 50,
      stateLabel: "이야기 중",
    });
    expect(axes.find((axis) => axis.key === "CUSTOMERS")).toMatchObject({
      resolved: 0,
      total: 0,
      completionPercent: 0,
      stateLabel: "해당 없음",
    });
    expect(businessMapRadarPoints(axes).split(" ")).toHaveLength(6);
  });

  it("excludes untouched optional signals until the borrower actually engages them", () => {
    const untouched = buildBusinessMap(allMapItems());
    expect(untouched.find((axis) => axis.key === "COSTS")).toMatchObject({ total: 1 });
    expect(untouched.find((axis) => axis.key === "CUSTOMERS")).toMatchObject({
      total: 0,
      stateLabel: "해당 없음",
    });

    const engaged = buildBusinessMap(allMapItems().map((candidate) =>
      candidate.infoCode === "repeat_customer_share"
        ? { ...candidate, status: "NEEDS_FOLLOWUP" as const }
        : candidate,
    ));
    expect(engaged.find((axis) => axis.key === "CUSTOMERS")).toMatchObject({
      total: 1,
      stateLabel: "이야기 중",
    });
  });

  it("shows only the latest confirmed server display value as an immediate insight", () => {
    const items = [
      item("monthly_average_sales", {
        label: "월평균 매출",
        status: "CONFIRMED",
        displayValue: "1,800만원 / 월",
        evidenceIds: ["ev-sales"],
        updatedAt: "2026-08-13T10:00:00.000Z",
      }),
      item("fixed_operating_costs", {
        label: "월 고정 운영비",
        status: "COLLECTED",
        displayValue: "900만원 / 월",
        updatedAt: "2026-08-13T10:03:00.000Z",
      }),
      item("improvement_plan", {
        label: "사업 개선 계획",
        category: "IMPROVEMENT_INTENT",
        status: "CONFIRMED",
        displayValue: "재방문 고객을 늘릴 계획",
        evidenceIds: ["ev-plan"],
        updatedAt: "2026-08-13T10:02:00.000Z",
      }),
    ];

    expect(latestGroundedInsight(items, [], [
      evidence("ev-sales", "monthly_average_sales"),
      evidence("ev-plan", "improvement_plan"),
    ])).toEqual({
      infoCode: "improvement_plan",
      label: "사업 개선 계획",
      displayValue: "재방문 고객을 늘릴 계획",
      text: "사장님 답변에서 확인한 내용이에요. 사업 개선 계획: 재방문 고객을 늘릴 계획",
    });
    expect(latestGroundedInsight([
      item("monthly_average_sales", { status: "COLLECTED", displayValue: "1,800만원 / 월" }),
    ], [], [])).toBeNull();
  });

  it("explains a server-computed fixed-cost ratio with both confirmed monthly values", () => {
    const items = [
      item("monthly_average_sales", {
        label: "월평균 매출",
        status: "CONFIRMED",
        displayValue: "1,800만원 / 월",
        evidenceIds: ["ev-sales"],
        updatedAt: "2026-08-13T10:00:00.000Z",
      }),
      item("fixed_operating_costs", {
        label: "월 고정 운영비",
        status: "CONFIRMED",
        displayValue: "900만원 / 월",
        evidenceIds: ["ev-costs"],
        updatedAt: "2026-08-13T10:01:00.000Z",
      }),
    ];
    const features = [feature("fixed_cost_ratio", {
      raw: "0.5",
      sourceInfoCodes: ["monthly_average_sales", "fixed_operating_costs"],
      evidenceIds: ["ev-sales", "ev-costs"],
      formula: "fixed_operating_costs / monthly_average_sales",
    })];

    expect(latestGroundedInsight(items, features, [
      evidence("ev-sales", "monthly_average_sales"),
      evidence("ev-costs", "fixed_operating_costs"),
    ])).toEqual({
      infoCode: "fixed_operating_costs",
      label: "매출·고정비 관계",
      displayValue: "50%",
      text: "같은 월 기준의 월평균 매출(1,800만원 / 월)과 월 고정 운영비(900만원 / 월)을 함께 확인했어요. 고정비/매출 비율은 50%로 계산됐으며, 값에 대한 평가는 아니에요.",
    });
  });

  it("mentions paired confirmed operating signals without asserting causality", () => {
    const items = [
      item("platform_fee_pressure", {
        label: "플랫폼 비용 부담",
        status: "CONFIRMED",
        displayValue: "플랫폼 비용부담 확인",
        evidenceIds: ["ev-platform"],
        updatedAt: "2026-08-13T10:00:00.000Z",
      }),
      item("hall_customer_decline", {
        label: "홀 손님 감소",
        status: "CONFIRMED",
        displayValue: "홀매출 감소 확인",
        evidenceIds: ["ev-hall"],
        updatedAt: "2026-08-13T10:01:00.000Z",
      }),
    ];
    const features = [feature("shock_present", {
      raw: "예",
      normalized: 1,
      sourceInfoCodes: ["hall_customer_decline"],
      evidenceIds: ["ev-hall"],
    })];

    const insight = latestGroundedInsight(items, features, [
      evidence("ev-platform", "platform_fee_pressure"),
      evidence("ev-hall", "hall_customer_decline"),
    ]);
    expect(insight).toMatchObject({
      label: "함께 확인한 운영 변화",
      displayValue: "플랫폼 비용부담 확인 · 홀매출 감소 확인",
    });
    expect(insight?.text).toContain("함께 확인했어요");
    expect(insight?.text).toContain("원인 관계를 뜻하지 않아요");
    expect(insight?.text).not.toMatch(/때문|영향|악화|위험|승인|신용/);
  });

  it("fails closed when feature sources, confirmation, raw value, or evidence are missing", () => {
    const sales = item("monthly_average_sales", {
      status: "CONFIRMED",
      displayValue: "1,800만원 / 월",
      evidenceIds: ["ev-sales"],
    });
    const costs = item("fixed_operating_costs", {
      status: "CONFIRMED",
      displayValue: "900만원 / 월",
      evidenceIds: ["ev-costs"],
    });
    const ratio = feature("fixed_cost_ratio", {
      raw: "0.5",
      sourceInfoCodes: ["monthly_average_sales", "fixed_operating_costs"],
      evidenceIds: ["ev-sales", "ev-costs"],
    });
    const evidenceManifest = [
      evidence("ev-sales", "monthly_average_sales"),
      evidence("ev-costs", "fixed_operating_costs"),
    ];

    expect(latestGroundedInsight([sales, { ...costs, status: "COLLECTED" }], [ratio], evidenceManifest)?.label)
      .not.toBe("매출·고정비 관계");
    expect(latestGroundedInsight([sales, costs], [{ ...ratio, raw: null }], evidenceManifest)?.label)
      .not.toBe("매출·고정비 관계");
    expect(latestGroundedInsight([sales, costs], [{ ...ratio, evidenceIds: ["missing"] }], evidenceManifest)?.label)
      .not.toBe("매출·고정비 관계");
    expect(latestGroundedInsight([sales, costs], [{ ...ratio, evidenceIds: ["ev-sales"] }], evidenceManifest)?.label)
      .not.toBe("매출·고정비 관계");
    expect(latestGroundedInsight([sales, costs], [{
      ...ratio,
      sourceInfoCodes: [...ratio.sourceInfoCodes, "unrelated_source"],
    }], evidenceManifest)?.label).not.toBe("매출·고정비 관계");
    expect(latestGroundedInsight([sales, costs], [ratio], [])).toBeNull();
  });

  it("builds an improvement board from confirmed items and a confirmed goal only", () => {
    const items = [
      item("monthly_average_sales", {
        label: "월평균 매출",
        status: "CONFIRMED",
        displayValue: "1,800만원 / 월",
      }),
      item("fixed_operating_costs", {
        label: "월 고정 운영비",
        status: "COLLECTED",
        displayValue: "900만원 / 월",
      }),
      item("improvement_plan", {
        category: "IMPROVEMENT_INTENT",
        status: "CONFIRMED",
        displayValue: "재방문 고객을 늘릴 계획",
      }),
      item("execution_readiness", {
        category: "IMPROVEMENT_INTENT",
        status: "NEEDS_FOLLOWUP",
        displayValue: "일부 준비",
      }),
    ];

    const unconfirmed = buildImprovementBoard(items, {
      ...baseGoal,
      title: "AI가 제안한 목표",
      status: "CANDIDATE",
    });
    expect(unconfirmed).toEqual([
      {
        key: "CURRENT",
        label: "지금까지 확인한 모습",
        value: "월평균 매출 1,800만원 / 월",
        sourceLabel: "확인된 답변",
      },
      {
        key: "DIRECTION",
        label: "사장님의 개선 방향",
        value: "재방문 고객을 늘릴 계획",
        sourceLabel: "확인된 답변",
      },
      { key: "READINESS", label: "실행 준비", value: null, sourceLabel: null },
    ]);

    const confirmed = buildImprovementBoard(items, {
      ...baseGoal,
      title: "3개월 동안 재방문 기록 늘리기",
      status: "CONFIRMED",
    });
    expect(confirmed[1]).toMatchObject({
      value: "3개월 동안 재방문 기록 늘리기",
      sourceLabel: "확인된 목표",
    });
  });

  it("offers explicit borrower statements for first-pass and bounded follow-up questions", () => {
    const plan = buildBorrowerExperience({
      informationItems: [item("improvement_plan", { category: "IMPROVEMENT_INTENT" })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "improvement_plan",
      questionReason: "PRIORITY",
      goal: null,
    });
    expect(plan.quickChoices).toHaveLength(5);
    expect(plan.quickChoices.map((choice) => choice.label)).toEqual([
      "매출 늘리기",
      "비용 줄이기",
      "재방문 늘리기",
      "상품·서비스 개선",
      "아직 정하지 못함",
    ]);
    expect(plan.quickChoices.every((choice) => choice.statement.endsWith("어요."))).toBe(true);

    const followup = buildBorrowerExperience({
      informationItems: [item("improvement_plan", {
        category: "IMPROVEMENT_INTENT",
        status: "NEEDS_FOLLOWUP",
      })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "improvement_plan",
      questionReason: "FOLLOWUP",
      goal: null,
    });
    expect(followup.quickChoices).toEqual([
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
    ]);
    expect(followup.questionPresentation.tone).toBe("FOLLOWUP");
    expect(followup.questionPresentation.helper).toContain("이번에도 어렵다면");

    const readiness = buildBorrowerExperience({
      informationItems: [item("execution_readiness", { category: "IMPROVEMENT_INTENT" })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "execution_readiness",
      questionReason: "PRIORITY",
      goal: null,
    });
    expect(readiness.quickChoices.map((choice) => choice.statement)).toContain("아직 준비하지 못했어요.");

    const reservations = buildBorrowerExperience({
      informationItems: [item("confirmed_reservations", { category: "FUTURE_OUTLOOK" })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "confirmed_reservations",
      questionReason: "PRIORITY",
      goal: null,
    });
    expect(reservations.quickChoices.map((choice) => choice.label)).toEqual([
      "확정된 건 없음",
      "있지만 건수는 모름",
    ]);

    const seasonality = buildBorrowerExperience({
      informationItems: [item("seasonality_outlook", { category: "FUTURE_OUTLOOK" })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "seasonality_outlook",
      questionReason: "PRIORITY",
      goal: null,
    });
    expect(seasonality.quickChoices.map((choice) => choice.label)).toEqual([
      "늘 것 같아요",
      "비슷할 것 같아요",
      "줄 것 같아요",
      "아직 모르겠어요",
    ]);

    const household = buildBorrowerExperience({
      informationItems: [item("essential_household_expenses", { category: "HOUSEHOLD_STATE" })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "essential_household_expenses",
      questionReason: "PRIORITY",
      goal: null,
    });
    expect(household.quickChoices.map((choice) => choice.label)).toEqual([
      "정확히 모르겠어요",
      "답하기 어려워요",
    ]);
  });

  it("gives conflicts and optional questions distinct, non-coercive presentation", () => {
    expect(borrowerQuestionPresentation({
      currentItem: item("fixed_operating_costs", { status: "CONFLICT" }),
      questionReason: "CONFLICT",
    })).toMatchObject({ tone: "CONFLICT" });
    expect(borrowerQuestionPresentation({
      currentItem: item("repeat_customer_share", { required: false }),
      questionReason: "PRIORITY",
    })).toEqual({
      tone: "OPTIONAL",
      label: "선택 질문",
      helper: "사업을 더 잘 이해하기 위한 질문이에요. 답하기 어렵다면 편하게 넘어가도 됩니다.",
    });

    const optional = buildBorrowerExperience({
      informationItems: [item("repeat_customer_share", { required: false })],
      features: [],
      evidence: [],
      currentQuestionInfoCode: "repeat_customer_share",
      questionReason: "PRIORITY",
      goal: null,
    });
    expect(optional.quickChoices).toEqual([
      {
        id: "optional-skip",
        label: "이 질문은 건너뛸게요",
        statement: "이 내용은 답변하기 어려워요.",
      },
    ]);
  });

  it("explains the purpose of each ordinary phase before asking for an answer", () => {
    expect(borrowerQuestionPresentation({
      currentItem: item("monthly_average_sales", { category: "CURRENT_STATE" }),
      questionReason: "PRIORITY",
    })).toMatchObject({
      tone: "STANDARD",
      label: "지금 사업의 기준점을 맞춰볼게요",
    });
    expect(borrowerQuestionPresentation({
      currentItem: item("essential_household_expenses", { category: "HOUSEHOLD_STATE" }),
      questionReason: "PRIORITY",
    })).toMatchObject({
      tone: "STANDARD",
      label: "생활과 사업이 연결되는 마지막 단계예요",
      helper: expect.stringContaining("범위로 답하거나"),
    });
  });
});

describe("canonical question speech", () => {
  const planDefinition = DEV_V1_INFORMATION_CATALOG.find(
    (definition) => definition.infoCode === "improvement_plan",
  )!;

  it("speaks catalog questions for repeatable ordinary and follow-up audio", () => {
    expect(canonicalQuestionForSpeech({
      infoCode: "improvement_plan",
      questionReason: "PRIORITY",
      displayedQuestion: "사장님 답변에 맞춘 동적 질문",
    })).toBe(planDefinition.question);
    expect(canonicalQuestionForSpeech({
      infoCode: "improvement_plan",
      questionReason: "FOLLOWUP",
      displayedQuestion: "동적 후속 질문",
    })).toBe(planDefinition.followupQuestion);
  });

  it("retains authoritative display wording for conflicts and unknown catalog codes", () => {
    expect(canonicalQuestionForSpeech({
      infoCode: "improvement_plan",
      questionReason: "CONFLICT",
      displayedQuestion: "두 답변 중 현재 상황은 어느 쪽인가요?",
    })).toBe("두 답변 중 현재 상황은 어느 쪽인가요?");
    expect(canonicalQuestionForSpeech({
      infoCode: "industry_specific_question",
      questionReason: "PRIORITY",
      displayedQuestion: "업종별 확인 질문",
    })).toBe("업종별 확인 질문");
  });

  it("separates a reaction from a finite cached conflict question", () => {
    const conflictQuestion =
      `기존 자료와 차이가 있습니다. ${planDefinition.label}의 산정 기준을 확인해 주세요.`;
    expect(presentedQuestion({
      infoCode: "improvement_plan",
      questionReason: "CONFLICT",
      displayedQuestion: `앞서 말씀과 자료가 달라 한 번만 확인할게요. ${conflictQuestion}`,
    })).toEqual({
      text: conflictQuestion,
      context: "앞서 말씀과 자료가 달라 한 번만 확인할게요.",
    });
  });

  it("separates a grounded reaction while keeping one exact shown and spoken question", () => {
    const reaction = "배달 비중이 늘었지만 남는 금액은 줄었다고 이해했어요.";
    expect(presentedQuestion({
      infoCode: "improvement_plan",
      questionReason: "PRIORITY",
      displayedQuestion: `${reaction} ${planDefinition.question}`,
    })).toEqual({
      text: planDefinition.question,
      context: reaction,
    });
  });

  it("does not present unmatched adaptive wording as a grounded reaction", () => {
    expect(presentedQuestion({
      infoCode: "improvement_plan",
      questionReason: "PRIORITY",
      displayedQuestion: "출처를 확인할 수 없는 임의 문구입니다.",
    })).toEqual({
      text: planDefinition.question,
      context: null,
    });
  });
});
