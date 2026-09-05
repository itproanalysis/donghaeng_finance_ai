import { describe, expect, it } from "vitest";

import {
  createDevV1ScenarioRequiredInformationItems,
  parseCanonicalInformation,
  type CanonicalInformationRecord,
  type DevV1AllInfoCode,
  type GoalSnapshot,
} from "../../src/domain";
import { OPERATING_DAY_DEMO_SCENARIO } from "../../src/domain/demo-scenario";
import {
  buildModelingInterviewAnswers,
  MODELING_UNMAPPED_FIELDS,
} from "../../src/domain/modeling-interview-mapping";

const scenario = OPERATING_DAY_DEMO_SCENARIO;

/**
 * 대본을 실제 parser에 넣어 나온 값으로 기록을 만든다. 매핑 검사가 손으로 적은
 * 값이 아니라 앱이 실제로 뽑는 값을 보게 하기 위해서다.
 */
function recordsFrom(answers: Readonly<Partial<Record<DevV1AllInfoCode, string>>>) {
  const items = createDevV1ScenarioRequiredInformationItems(scenario.triggeredInfoCodes);
  const records: CanonicalInformationRecord[] = [];
  for (const item of items) {
    const infoCode = item.infoCode as DevV1AllInfoCode;
    const answer = answers[infoCode];
    if (!answer) continue;
    const candidate = parseCanonicalInformation(infoCode, answer);
    if (!candidate) continue;
    records.push({
      infoCode,
      category: item.category,
      required: item.required,
      priority: item.priority,
      minQuality: item.minQuality,
      status: candidate.proposedStatus,
      valueState: candidate.valueState,
      selectedRevisionId: `${infoCode}-r1`,
      revisions: [
        {
          id: `${infoCode}-r1`,
          infoCode,
          revision: 1,
          valueState: candidate.valueState,
          value: candidate.value,
          quality: candidate.quality,
          parserConfidence: candidate.parserConfidence,
          verification: candidate.verification,
          evidenceIds: [],
          observedAt: "2026-09-05T00:00:00.000Z",
          status: "SELECTED",
          supersedesRevisionId: null,
        },
      ],
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
  }
  return records;
}

function goalFrom(target: number | null, periodMonths: number | null): GoalSnapshot {
  return {
    policyVersion: "dev-v1",
    status: target === null ? "NO_GOAL_STATED" : "CONFIRMED",
    numericStatus: target === null ? "NOT_APPLICABLE" : "DIRECT",
    title: target === null ? null : "여는 날 늘리기",
    origin: target === null ? null : "BORROWER_STATED",
    baseline: target === null ? null : { value: { kind: "EXACT", value: 23 }, unit: "DAY" },
    target: target === null ? null : { value: { kind: "EXACT", value: target }, unit: "DAY" },
    period: periodMonths === null ? null : { value: periodMonths, unit: "MONTH" },
    unit: target === null ? null : "DAY",
    measurementSources: target === null ? [] : ["ACCOUNTING_LEDGER"],
    context: null,
    behaviorEvent: null,
    evidenceIds: [],
    missingFields: [],
  };
}

describe("인터뷰 결과를 modeling 입력으로 옮기기", () => {
  const primary = buildModelingInterviewAnswers({
    industryCode: scenario.persona.industryCode,
    informationItems: recordsFrom(scenario.primary.answers),
    goalSnapshot: goalFrom(29, 6),
  });

  it("점수에 들어가는 값이 mock 케이스와 같다", () => {
    expect(primary).toMatchObject({
      stated_monthly_sales: 26_000_000,
      own_operating_day_drop_reason: "건강",
      own_operating_day_drop_resolved_flag: true,
      own_goal_evidence_feature: "biz_operating_day_count_avg_3m",
      own_goal_target_value: 29,
      own_goal_horizon_days: 180,
      own_plan_budget: 800_000,
      own_buffer_months: 3,
      ops_repeat_customer_ratio: 0.45,
      own_seasonality_direction: "비수기",
    });
  });

  it("음식점은 잡혀 있는 계약을 해당 없음으로 남긴다", () => {
    expect(primary.own_booking_coverage_weeks).toBe("NOT_APPLICABLE");
    expect(
      buildModelingInterviewAnswers({
        industryCode: "INTERIOR",
        informationItems: recordsFrom(scenario.primary.answers),
        goalSnapshot: goalFrom(29, 6),
      }).own_booking_coverage_weeks,
    ).toBe("MISSING");
  });

  it("답을 거부한 항목을 0으로 채우지 않는다", () => {
    const refused = buildModelingInterviewAnswers({
      industryCode: scenario.persona.industryCode,
      informationItems: recordsFrom({
        ...scenario.primary.answers,
        essential_household_expenses: "가계지출은 말씀드리기 어렵습니다.",
      }),
      goalSnapshot: goalFrom(29, 6),
    });

    expect(refused.own_essential_expense).toBe("REFUSED");
    expect(primary.own_essential_expense).toBe(2_200_000);
  });

  it("옮기지 않는 필드를 값으로 만들지 않는다", () => {
    for (const field of Object.keys(MODELING_UNMAPPED_FIELDS)) {
      expect(["MISSING", "NOT_APPLICABLE"], `${field}에 값이 생겼습니다.`).toContain(
        primary[field],
      );
    }
  });

  it("사유와 목표를 답하지 않으면 점수 재료가 사라진다", () => {
    const control = buildModelingInterviewAnswers({
      industryCode: scenario.persona.industryCode,
      informationItems: recordsFrom(scenario.control.answers),
      goalSnapshot: goalFrom(null, null),
    });

    expect(control.own_operating_day_drop_reason).toBe("MISSING");
    expect(control.own_goal_target_value).toBe("UNDECIDED");
    expect(control.own_goal_horizon_days).toBe("UNDECIDED");
    expect(control.own_plan_budget).toBe("UNDECIDED");
  });

  it("두 번 옮겨도 결과가 같다", () => {
    const again = buildModelingInterviewAnswers({
      industryCode: scenario.persona.industryCode,
      informationItems: recordsFrom(scenario.primary.answers),
      goalSnapshot: goalFrom(29, 6),
    });
    expect(again).toEqual(primary);
  });
});
