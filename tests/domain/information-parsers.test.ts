import { describe, expect, it } from "vitest";

import {
  createDefaultRequiredInformationItems,
  parseCanonicalInformation,
  planDeterministicInterviewTurn,
  type CanonicalInformationValue,
  type InformationItem,
} from "../../src/domain";

function valueOf<T extends CanonicalInformationValue["kind"]>(
  candidate: ReturnType<typeof parseCanonicalInformation>,
  kind: T,
): Extract<CanonicalInformationValue, { kind: T }> {
  expect(candidate?.valueState).toBe("PRESENT");
  expect(candidate?.value?.kind).toBe(kind);
  return candidate?.value as Extract<CanonicalInformationValue, { kind: T }>;
}

describe("8개 canonical information parser", () => {
  it("월매출·고정비·가계지출의 exact KRW와 기준기간을 구분한다", () => {
    const sales = valueOf(
      parseCanonicalInformation("monthly_average_sales", "월평균 매출은 2,300만원입니다"),
      "PERIODIC_MONEY",
    );
    const costs = valueOf(
      parseCanonicalInformation("fixed_operating_costs", "고정비는 월 1,000만원입니다"),
      "PERIODIC_MONEY",
    );
    const household = valueOf(
      parseCanonicalInformation(
        "essential_household_expenses",
        "필수 가계지출은 월 300만원입니다",
      ),
      "PERIODIC_MONEY",
    );

    expect(sales.amount).toEqual({ kind: "EXACT", value: 23_000_000 });
    expect(sales.aggregation).toBe("AVERAGE");
    expect(costs.amount).toEqual({ kind: "EXACT", value: 10_000_000 });
    expect(costs.basis).toBe("FIXED_OPERATING_COST_TOTAL");
    expect(household.amount).toEqual({ kind: "EXACT", value: 3_000_000 });
  });

  it("금액·건수·기간 range를 midpoint 없이 보존한다", () => {
    const sales = valueOf(
      parseCanonicalInformation("monthly_average_sales", "월평균 매출은 1,000~1,500만원입니다"),
      "PERIODIC_MONEY",
    );
    const reservations = valueOf(
      parseCanonicalInformation("confirmed_reservations", "확정 예약은 2~3건입니다"),
      "CONFIRMED_RESERVATIONS",
    );
    const buffer = valueOf(
      parseCanonicalInformation("emergency_buffer_months", "비상자금은 2~4개월입니다"),
      "DURATION",
    );

    expect(sales.amount).toEqual({ kind: "RANGE", min: 10_000_000, max: 15_000_000 });
    expect(reservations.count).toEqual({ kind: "RANGE", min: 2, max: 3 });
    expect(buffer.duration).toEqual({ kind: "RANGE", min: 2, max: 4 });
  });

  it("0/계획 없음/준비 안 됨을 missing·N/A로 바꾸지 않는다", () => {
    const sales = valueOf(
      parseCanonicalInformation("monthly_average_sales", "매출이 발생하지 않아 0원입니다"),
      "PERIODIC_MONEY",
    );
    const reservations = valueOf(
      parseCanonicalInformation("confirmed_reservations", "확정 예약은 없습니다"),
      "CONFIRMED_RESERVATIONS",
    );
    const buffer = valueOf(
      parseCanonicalInformation("emergency_buffer_months", "비상자금은 없습니다"),
      "DURATION",
    );
    const plan = valueOf(
      parseCanonicalInformation("improvement_plan", "아직 개선 계획은 없습니다"),
      "IMPROVEMENT_PLAN",
    );
    const readiness = valueOf(
      parseCanonicalInformation("execution_readiness", "아직 준비하지 못했습니다"),
      "EXECUTION_READINESS",
    );

    expect(sales.amount).toEqual({ kind: "EXACT", value: 0 });
    expect(reservations.count).toEqual({ kind: "EXACT", value: 0 });
    expect(buffer.duration).toEqual({ kind: "EXACT", value: 0 });
    expect(plan.planExists).toBe(false);
    expect(readiness.state).toBe("NOT_STARTED");
  });

  it("개선계획은 직접 말한 문제·행동·기간·수치·출처만 구조화한다", () => {
    const plan = valueOf(
      parseCanonicalInformation(
        "improvement_plan",
        "개선 계획은 폐기 비용이 문제입니다. 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
      ),
      "IMPROVEMENT_PLAN",
    );

    expect(plan.planExists).toBe(true);
    expect(plan.problem).toContain("문제");
    expect(plan.actions.some((action) => action.text.includes("줄이"))).toBe(true);
    expect(plan.schedule?.duration).toEqual({ kind: "EXACT", value: 3 });
    expect(plan.baseline).toEqual({ value: { kind: "EXACT", value: 10 }, unit: "%" });
    expect(plan.target).toEqual({ value: { kind: "EXACT", value: 5 }, unit: "%" });
    expect(plan.measurementSources).toContain("POS");
  });

  it("개선계획의 baseline·target·기간·측정원이 모두 없으면 후속질문 상태를 유지한다", () => {
    const targetOnly = parseCanonicalInformation(
      "improvement_plan",
      "폐기 비용이 문제라 POS로 폐기를 줄여 목표 5%로 만들겠습니다.",
    );
    const periodOnly = parseCanonicalInformation(
      "improvement_plan",
      "폐기 비용이 문제라 앞으로 3개월 안에 POS로 폐기를 줄이겠습니다.",
    );

    expect(targetOnly).toMatchObject({
      proposedStatus: "NEEDS_FOLLOWUP",
      missingFields: expect.arrayContaining(["baseline", "period"]),
    });
    expect(periodOnly).toMatchObject({
      proposedStatus: "NEEDS_FOLLOWUP",
      missingFields: expect.arrayContaining(["baseline", "target"]),
    });
  });

  it("개선목표의 한국어 금액 단위를 KRW로 보존하고 비율로 추정하지 않는다", () => {
    const candidate = parseCanonicalInformation(
      "improvement_plan",
      "재료비 부담이 문제라 앞으로 3개월 동안 장부로 확인하며 현재 100만원에서 목표 50만원으로 줄이겠습니다.",
    );
    const plan = valueOf(candidate, "IMPROVEMENT_PLAN");

    expect(candidate).toMatchObject({ proposedStatus: "CONFIRMED", missingFields: [] });
    expect(plan.baseline).toEqual({
      value: { kind: "EXACT", value: 1_000_000 },
      unit: "KRW",
    });
    expect(plan.target).toEqual({
      value: { kind: "EXACT", value: 500_000 },
      unit: "KRW",
    });
  });

  it("예약과 계절전망에서 건수·총액과 근거를 분리한다", () => {
    const reservations = valueOf(
      parseCanonicalInformation(
        "confirmed_reservations",
        "확정 예약은 3건이고 총액은 120만원입니다",
      ),
      "CONFIRMED_RESERVATIONS",
    );
    const season = valueOf(
      parseCanonicalInformation(
        "seasonality_outlook",
        "계절성 전망은 작년보다 수요가 10% 증가할 것으로 봅니다",
      ),
      "SEASONALITY_OUTLOOK",
    );

    expect(reservations.count).toEqual({ kind: "EXACT", value: 3 });
    expect(reservations.totalOrderValue).toEqual({ kind: "EXACT", value: 1_200_000 });
    expect(season.direction).toBe("UP");
    expect(season.expectedChangePct).toEqual({ kind: "EXACT", value: 10 });
    expect(season.bases.map((basis) => basis.kind)).toContain("HISTORICAL");
  });

  it("모호·거절·unknown을 명시 terminal/follow-up disposition으로 구분한다", () => {
    expect(
      parseCanonicalInformation("fixed_operating_costs", "운영비가 여러 개라 잘 모르겠습니다"),
    ).toMatchObject({ valueState: "UNKNOWN", proposedStatus: "UNAVAILABLE" });
    expect(
      parseCanonicalInformation("essential_household_expenses", "생활비 답변을 거부합니다"),
    ).toMatchObject({ valueState: "REFUSED", proposedStatus: "REFUSED" });
    expect(
      parseCanonicalInformation("improvement_plan", "그 부분은 말하기 싫어요"),
    ).toMatchObject({ valueState: "REFUSED", proposedStatus: "REFUSED" });
    expect(
      parseCanonicalInformation("monthly_average_sales", "매출은 현금 100만원, 카드 200만원입니다"),
    ).toMatchObject({ valueState: "UNKNOWN", proposedStatus: "NEEDS_FOLLOWUP" });
    for (const answer of ["모름", "모른다니까", "잘 몰라요"]) {
      expect(
        parseCanonicalInformation("confirmed_reservations", answer),
      ).toMatchObject({
        valueState: "UNKNOWN",
        proposedStatus: "UNAVAILABLE",
        terminalDisposition: "UNAVAILABLE",
      });
    }
  });
});

describe("deterministic multi-extraction orchestrator", () => {
  function items(): InformationItem[] {
    return createDefaultRequiredInformationItems().map((item, index) => ({
      ...item,
      valueState: "MISSING",
      value: null,
      quality: null,
      extractionConfidence: null,
      verification: null,
      evidenceIds: [],
      prefill: null,
      updatedAt: `2026-08-10T00:00:0${index}.000Z`,
    }));
  }

  it("한 확정 답변에서 명시 anchor가 있는 3개 항목을 원자적 turn plan으로 만든다", () => {
    const plan = planDeterministicInterviewTurn({
      text: "월 매출은 2,300만원, 고정비는 1,000만원, 필수 가계지출은 300만원입니다",
      currentInfoCode: "monthly_average_sales",
      informationItems: items(),
    });

    expect(plan.extractedItems.map((item) => item.infoCode)).toEqual([
      "monthly_average_sales",
      "fixed_operating_costs",
      "essential_household_expenses",
    ]);
    expect(plan.stateChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ infoCode: "monthly_average_sales", from: "ASKING", to: "COLLECTED" }),
        expect.objectContaining({ infoCode: "fixed_operating_costs", from: "NEEDED", to: "COLLECTED", incidentalExtraction: true }),
      ]),
    );
  });

  it("추가 확인을 한 번 했는데도 답이 불명확하면 해당 항목을 알 수 없음으로 종결한다", () => {
    const followupItems = items().map((item) =>
      item.infoCode === "improvement_plan" ? { ...item, status: "NEEDS_FOLLOWUP" as const } : item,
    );
    const plan = planDeterministicInterviewTurn({
      text: "없다고요.",
      currentInfoCode: "improvement_plan",
      informationItems: followupItems,
      followupExhaustedInfoCodes: ["improvement_plan"],
    });

    expect(plan.extractedItems.find((item) => item.infoCode === "improvement_plan")).toMatchObject({
      valueState: "UNKNOWN",
      value: null,
      proposedStatus: "UNAVAILABLE",
      terminalDisposition: "UNAVAILABLE",
    });
    expect(plan.stateChanges.filter((change) => change.infoCode === "improvement_plan").map((change) => change.to))
      .toEqual(["ASKING", "UNAVAILABLE"]);
    expect(plan.nextQuestion?.infoCode).not.toBe("improvement_plan");
  });

  it("비현재 항목은 강한 semantic anchor가 없으면 숫자를 오귀속하지 않는다", () => {
    const plan = planDeterministicInterviewTurn({
      text: "2,300만원입니다",
      currentInfoCode: "monthly_average_sales",
      informationItems: items(),
    });
    expect(plan.extractedItems).toHaveLength(1);
    expect(plan.extractedItems[0].infoCode).toBe("monthly_average_sales");
  });

  it("목표 필드가 덜 채워진 개선계획은 같은 항목 후속질문으로 돌아간다", () => {
    const informationItems = items().map((item) => ({
      ...item,
      status:
        item.infoCode === "monthly_average_sales"
          ? ("CONFIRMED" as const)
          : item.infoCode === "improvement_plan"
            ? ("ASKING" as const)
            : item.status,
    }));
    const plan = planDeterministicInterviewTurn({
      text: "폐기 비용이 문제라 POS로 폐기를 줄여 목표 5%로 만들겠습니다.",
      currentInfoCode: "improvement_plan",
      informationItems,
    });

    expect(plan.stateChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          infoCode: "improvement_plan",
          from: "COLLECTED",
          to: "NEEDS_FOLLOWUP",
        }),
      ]),
    );
    expect(plan.nextQuestion).toMatchObject({
      infoCode: "improvement_plan",
      reason: "FOLLOWUP",
    });
  });
});
