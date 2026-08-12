import { describe, expect, it } from "vitest";

import {
  DEV_V1_INFORMATION_CATALOG,
  createDevV1AcceptanceRequiredInformationItems,
  buildFeatureV2,
  buildFeatureV2MissingnessReport,
  buildInferenceFeatureV2,
  buildInterviewFeatureV2,
  buildTrainingFeatureV2,
  createCanonicalValueRevision,
  FEATURE_DICTIONARY_V2,
  parseCanonicalInformation,
  rawFeatureV2FromInterview,
  selectCanonicalRevision,
  validateFeatureDictionaryV2,
  type CanonicalInformationRecord,
  type DevV1AllInfoCode,
} from "../../src/domain";

function feature(set: ReturnType<typeof buildFeatureV2>, name: string) {
  const result = set.features.find((candidate) => candidate.name === name);
  if (!result) throw new Error(`missing feature ${name}`);
  return result;
}

function record(infoCode: string, text: string): CanonicalInformationRecord {
  const definition = createDevV1AcceptanceRequiredInformationItems().find(
    (item) => item.infoCode === infoCode,
  ) ?? DEV_V1_INFORMATION_CATALOG.find((item) => item.infoCode === infoCode);
  if (!definition) throw new Error(`unknown info ${infoCode}`);
  const candidate = parseCanonicalInformation(definition.infoCode as DevV1AllInfoCode, text);
  if (!candidate?.value) throw new Error(`parse failed for ${infoCode}`);
  const revision = createCanonicalValueRevision({
    id: `revision-${infoCode}`,
    infoCode,
    valueState: "PRESENT",
    value: candidate.value,
    quality: definition.minQuality,
    parserConfidence: 1,
    verification: "SELF_REPORTED",
    evidenceIds: [`evidence-${infoCode}`],
    observedAt: "2026-08-12T00:00:00.000Z",
  });
  return {
    infoCode,
    category: definition.category,
    required: definition.required,
    priority: definition.priority,
    minQuality: definition.minQuality,
    status: "CONFIRMED",
    valueState: "PRESENT",
    selectedRevisionId: revision.id,
    revisions: selectCanonicalRevision([revision], revision.id),
    updatedAt: revision.observedAt,
  };
}

describe("feature_schema_v2", () => {
  it("has a traceable dictionary across all requested groups without duplicate names", () => {
    expect(validateFeatureDictionaryV2()).toEqual([]);
    expect(FEATURE_DICTIONARY_V2.length).toBeGreaterThanOrEqual(60);
    expect(FEATURE_DICTIONARY_V2.length).toBeLessThanOrEqual(120);
    expect(new Set(FEATURE_DICTIONARY_V2.map((definition) => definition.group))).toEqual(
      new Set(["business", "financial", "credit", "operation", "owner", "external", "improvement"]),
    );
    expect(FEATURE_DICTIONARY_V2.every((definition) => definition.modelCandidate === false)).toBe(true);
  });

  it("uses one deterministic builder for training and inference and keeps zeros distinct from missing", () => {
    const input = {
      raw: {
        fin_sales_growth_3m: 0.12,
        fin_cashflow_trend_slope_6m: 0.08,
        fin_month_end_balance_growth_3m: 0.1,
        crd_delinquency_recovery_trend: 1,
        biz_recent_activity_flag: true,
        fin_net_cashflow_positive_month_ratio_6m: 1,
        fin_cashflow_deficit_month_count_6m: 0,
        crd_payment_to_sales_ratio: 0,
        fin_fixed_cost_gap_peer: 0.1,
        fin_marketing_cost_gap_peer: 0.2,
        fin_interest_cost_ratio: 0.05,
        own_goal_category: "cost_reduction",
        biz_sales_recovery_from_min_6m: 0.3,
        ops_repeat_customer_ratio: 0.45,
        own_goal_target_value: 30,
        own_goal_horizon_days: 60,
        own_plan_horizon_days: 60,
        own_plan_budget: 500_000,
        own_plan_weekly_time_hours: 2,
        own_plan_measurement_metric: "POS",
        own_plan_start_date: "2026-08-15",
        own_plan_constraint_count: 0,
        own_primary_problem_category: "cost_burden",
      },
      external: {
        ext_sales_growth_gap_peer: 0.05,
      },
    };
    expect(buildTrainingFeatureV2(input)).toEqual(buildInferenceFeatureV2(input));
    const output = buildFeatureV2(input);
    expect(feature(output, "fin_cashflow_deficit_month_count_6m")).toMatchObject({ state: "COMPUTED", value: 0 });
    expect(feature(output, "imp_recovery_momentum")).toMatchObject({ state: "COMPUTED" });
    expect(feature(output, "imp_cashflow_stabilization")).toMatchObject({ state: "COMPUTED" });
    expect(feature(output, "imp_cost_adjustment_headroom")).toMatchObject({ state: "COMPUTED" });
    expect(feature(output, "imp_sales_recovery_potential")).toMatchObject({ state: "COMPUTED" });
    expect(feature(output, "imp_plan_specificity")).toMatchObject({ state: "COMPUTED", value: 1 });
    expect(feature(output, "imp_plan_feasibility")).toMatchObject({ state: "COMPUTED", value: 1 });
    expect(feature(output, "imp_goal_problem_alignment")).toMatchObject({ state: "COMPUTED", value: 1 });
    expect(feature(output, "ext_sales_growth_gap_peer")).toMatchObject({ state: "COMPUTED", value: 0.05 });
  });

  it("does not turn absent, invalid, or disabled values into zeros", () => {
    const output = buildFeatureV2({ raw: { fin_sales_growth_3m: Number.NaN } });
    expect(feature(output, "fin_sales_growth_3m")).toMatchObject({ state: "MISSING", value: null });
    expect(feature(output, "imp_recovery_momentum")).toMatchObject({ state: "MISSING", value: null });
    const disabled = buildFeatureV2({ raw: { fin_sales_growth_3m: 0.1 } }, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.features.every((value) => value.state === "MISSING" && value.value === null)).toBe(true);
  });

  it("preserves only direct exact interview values and produces a per-feature missingness report", () => {
    const records = [
      record("monthly_average_sales", "최근 3개월 기준 월평균 매출은 2,300만원입니다."),
      record("fixed_operating_costs", "최근 3개월 기준 월 고정비는 1,000만원입니다."),
      record("repeat_customer_share", "최근 한 달 기준 단골 매출은 45%입니다."),
      record("improvement_plan", "직접주문을 현재 18%에서 목표 30%로 두 달 안에 늘리고 POS로 확인하겠습니다."),
      record("execution_readiness", "예산은 월 50만원이고, 8주 일정으로 준비했습니다. 현재 인력이 부족한 점이 제약입니다."),
    ];
    const raw = rawFeatureV2FromInterview(records);
    expect(raw).toMatchObject({
      fin_sales_avg_3m: 23_000_000,
      fin_fixed_cost_ratio: 10_000_000 / 23_000_000,
      ops_repeat_customer_ratio: 0.45,
      own_goal_target_value: 30,
      own_goal_horizon_days: 56,
    });
    const fromInterview = buildInterviewFeatureV2(records);
    expect(feature(fromInterview, "imp_plan_specificity").state).toBe("COMPUTED");
    const report = buildFeatureV2MissingnessReport([fromInterview, buildFeatureV2({ raw: {} })]);
    expect(report.find((item) => item.name === "fin_sales_avg_3m")).toMatchObject({
      missingRate: 0.5,
      uniqueCount: 1,
    });
  });
});
