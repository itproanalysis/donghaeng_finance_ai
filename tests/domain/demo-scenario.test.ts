import { describe, expect, it } from "vitest";

import {
  createDevV1ScenarioRequiredInformationItems,
  parseCanonicalInformation,
  validateRequiredInformationCatalog,
  type DevV1AllInfoCode,
} from "../../src/domain";
import { OPERATING_DAY_DEMO_SCENARIO } from "../../src/domain/demo-scenario";

const scenario = OPERATING_DAY_DEMO_SCENARIO;

function parse(infoCode: DevV1AllInfoCode, answer: string) {
  const candidate = parseCanonicalInformation(infoCode, answer);
  expect(candidate, `${infoCode} 답변에서 후보를 만들지 못했습니다.`).not.toBeNull();
  return candidate!;
}

describe("심사 시연 시나리오", () => {
  it("시나리오 목록은 11항목에 영업일 사유 하나만 더한다", () => {
    const items = createDevV1ScenarioRequiredInformationItems(scenario.triggeredInfoCodes);

    expect(items).toHaveLength(12);
    expect(items.at(-1)?.infoCode).toBe("operating_day_drop_reason");
    expect(validateRequiredInformationCatalog(items, { requireDevV1Codes: true })).toEqual([]);
  });

  it("조건에 걸리지 않으면 영업일 사유를 넣지 않는다", () => {
    expect(createDevV1ScenarioRequiredInformationItems([])).toHaveLength(11);
    expect(createDevV1ScenarioRequiredInformationItems(["unknown_code"])).toHaveLength(11);
  });

  it("대본의 모든 답변이 12항목을 후속질문 없이 확정한다", () => {
    const items = createDevV1ScenarioRequiredInformationItems(scenario.triggeredInfoCodes);

    for (const item of items) {
      const answer = scenario.primary.answers[item.infoCode as DevV1AllInfoCode];
      expect(answer, `${item.infoCode} 대본이 없습니다.`).toBeDefined();

      const candidate = parse(item.infoCode as DevV1AllInfoCode, answer!);
      expect(
        candidate.missingFields,
        `${item.infoCode}에 후속질문이 남았습니다.`,
      ).toEqual([]);
      expect(
        ["CONFIRMED", "REFUSED"],
        `${item.infoCode} 상태가 ${candidate.proposedStatus}입니다.`,
      ).toContain(candidate.proposedStatus);
    }
  });

  it("영업일 사유를 건강과 해소됨으로 뽑는다", () => {
    const candidate = parse(
      "operating_day_drop_reason",
      scenario.primary.answers.operating_day_drop_reason!,
    );

    expect(candidate.value).toMatchObject({
      kind: "BUSINESS_SIGNAL",
      signal: "OPERATING_DAY_DROP",
      observed: true,
      reason: "HEALTH",
      resolved: true,
    });
  });

  it("개선 계획에서 영업일 목표와 기간과 측정원을 뽑는다", () => {
    const candidate = parse("improvement_plan", scenario.primary.answers.improvement_plan!);

    expect(candidate.value).toMatchObject({
      kind: "IMPROVEMENT_PLAN",
      planExists: true,
      baseline: { value: { kind: "EXACT", value: 23 }, unit: "DAY" },
      target: { value: { kind: "EXACT", value: 29 }, unit: "DAY" },
      measurementSources: ["ACCOUNTING_LEDGER"],
    });
    expect(candidate.value).toMatchObject({
      schedule: { unit: "MONTH", duration: { kind: "EXACT", value: 6 } },
    });
  });

  it("실행 준비에서 계획 예산과 걸림돌을 뽑는다", () => {
    const candidate = parse("execution_readiness", scenario.primary.answers.execution_readiness!);

    expect(candidate.value).toMatchObject({
      kind: "EXECUTION_READINESS",
      state: "READY",
      budget: {
        basis: "IMPROVEMENT_PLAN_BUDGET",
        amount: { kind: "EXACT", value: 800_000 },
      },
    });
    expect(
      (candidate.value as { resources: { type: string }[] }).resources.map((item) => item.type),
    ).toEqual(["BUDGET", "SCHEDULE"]);
  });

  it("준비하지 못한 답에서는 예산을 만들지 않는다", () => {
    const candidate = parse("execution_readiness", scenario.control.answers.execution_readiness!);

    expect(candidate.value).toMatchObject({ state: "NOT_STARTED", budget: null, resources: [] });
  });

  it("매출과 고정비를 mock 케이스와 같은 금액으로 뽑는다", () => {
    expect(parse("monthly_average_sales", scenario.primary.answers.monthly_average_sales!).value)
      .toMatchObject({ amount: { kind: "EXACT", value: 26_000_000 } });
    expect(parse("fixed_operating_costs", scenario.primary.answers.fixed_operating_costs!).value)
      .toMatchObject({ amount: { kind: "EXACT", value: 11_900_000 } });
  });

  it("대조 인터뷰는 사유와 목표를 값으로 남기지 않는다", () => {
    const reason = parse(
      "operating_day_drop_reason",
      scenario.control.answers.operating_day_drop_reason!,
    );
    expect(reason.terminalDisposition).toBe("UNAVAILABLE");
    expect(reason.value).toBeNull();

    const plan = parse("improvement_plan", scenario.control.answers.improvement_plan!);
    expect(plan.value).toMatchObject({ planExists: false, target: null, baseline: null });
  });

  it("사유 진술이 보기에 닿지 않으면 값을 만들지 않고 다시 묻는다", () => {
    const candidate = parse("operating_day_drop_reason", "그냥 사정이 좀 있었습니다.");

    expect(candidate.value).toBeNull();
    expect(candidate.proposedStatus).toBe("NEEDS_FOLLOWUP");
    expect(candidate.missingFields).toEqual(["reason"]);
  });

  it("사유는 말했지만 해소 여부를 말하지 않으면 다시 묻는다", () => {
    const candidate = parse("operating_day_drop_reason", "허리를 다쳐서 문을 자주 닫았습니다.");

    expect(candidate.proposedStatus).toBe("NEEDS_FOLLOWUP");
    expect(candidate.missingFields).toEqual(["resolution"]);
  });
});
