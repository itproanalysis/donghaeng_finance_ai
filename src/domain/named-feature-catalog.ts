import type { InformationCategory } from "./interview";

export const NAMED_FEATURE_CATALOG_VERSION = "dev-v1" as const;

export type NamedFeatureImplementationState = "IMPLEMENTED" | "PARTIAL" | "MISSING";

const CURRENT_STATE_FEATURES = [
  ["business_tenure_months", "업력(개월)"],
  ["industry_experience_months", "동종업 경험(개월)"],
  ["sales_slope_3m", "3개월 매출 추세"],
  ["sales_slope_6m", "6개월 매출 추세"],
  ["sales_cv_6m", "6개월 매출 변동계수"],
  ["sales_yoy", "전년 동기 대비 매출"],
  ["season_adjusted_sales_delta", "계절조정 매출 변화"],
  ["fixed_cost_ratio", "고정비 비율"],
  ["labor_cost_ratio", "인건비 비율"],
  ["input_cost_ratio", "투입원가 비율"],
  ["platform_fee_ratio", "플랫폼 수수료 비율"],
  ["cashflow_mismatch_days", "현금흐름 시차"],
  ["settlement_lag_days", "정산 지연일"],
  ["receivable_days", "매출채권 회수일"],
  ["cash_shortage_frequency", "현금부족 빈도"],
  ["business_cash_buffer_days", "사업 현금 버퍼일"],
  ["repeat_customer_share", "반복고객 비중"],
  ["top1_customer_share", "최대 고객 비중"],
  ["top3_customer_share", "상위 3개 고객 비중"],
  ["channel_hhi", "판매채널 집중도"],
  ["shock_present", "사업 충격 존재"],
  ["shock_duration_days", "사업 충격 지속일"],
  ["shock_resolved", "사업 충격 해소 여부"],
  ["weeks_to_recovery", "회복 소요주"],
  ["recovery_velocity", "회복 속도"],
] as const;

const IMPROVEMENT_INTENT_FEATURES = [
  ["problem_specificity", "문제 인식 구체성"],
  ["root_cause_identified", "근본원인 식별"],
  ["self_plan_exists", "차주 자체 계획 존재"],
  ["plan_action_count", "계획 행동 수"],
  ["plan_specificity", "계획 구체성"],
  ["plan_time_bound", "계획 기간 명시"],
  ["plan_measurability", "계획 측정 가능성"],
  ["measurement_method_defined", "측정방법 정의"],
  ["execution_readiness", "실행 준비도"],
  ["resource_awareness", "필요자원 인식"],
  ["obstacle_awareness", "장애요인 인식"],
  ["past_execution_example_count", "과거 실행 사례 수"],
  ["past_execution_result", "과거 실행 결과"],
  ["evidence_readiness", "근거자료 준비도"],
] as const;

const FUTURE_OUTLOOK_FEATURES = [
  ["confirmed_order_value", "확정 주문 금액"],
  ["booking_count", "예약 건수"],
  ["booking_coverage_weeks", "예약 커버리지(주)"],
  ["pipeline_value", "영업 파이프라인 금액"],
  ["pipeline_coverage_months", "파이프라인 커버리지(개월)"],
  ["repeat_demand_share", "반복수요 비중"],
  ["contracted_revenue_share", "계약매출 비중"],
  ["customer_growth_rate", "고객 증가율"],
  ["season_adjusted_growth", "계절조정 성장률"],
  ["channel_diversification", "채널 다변화"],
  ["customer_concentration", "고객 집중도"],
  ["demand_visibility", "수요 가시성"],
] as const;

const HOUSEHOLD_STATE_FEATURES = [
  ["household_nonbusiness_income", "가계 비사업소득"],
  ["household_income_stability", "가계소득 안정성"],
  ["essential_household_expense", "필수 가계지출"],
  ["housing_fixed_expense", "주거 고정비"],
  ["personal_debt_service", "개인 채무상환액"],
  ["household_disposable_surplus", "가계 가처분 잉여"],
  ["household_buffer_months", "가계 버퍼 개월"],
  ["business_to_household_transfer_ratio", "사업→가계 이전 비율"],
  ["business_household_account_separation", "사업·가계 계좌 분리"],
] as const;

export const REQUIRED_NAMED_FEATURE_CODES = [
  ...CURRENT_STATE_FEATURES.map(([code]) => code),
  ...IMPROVEMENT_INTENT_FEATURES.map(([code]) => code),
  ...FUTURE_OUTLOOK_FEATURES.map(([code]) => code),
  ...HOUSEHOLD_STATE_FEATURES.map(([code]) => code),
] as const;

export type RequiredNamedFeatureCode = (typeof REQUIRED_NAMED_FEATURE_CODES)[number];

interface FeatureImplementation {
  implementationState: Exclude<NamedFeatureImplementationState, "MISSING">;
  runtimeFeatureName: RequiredNamedFeatureCode;
  calculationRuleId: string;
}

const FEATURE_IMPLEMENTATIONS = {
  fixed_cost_ratio: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "fixed_cost_ratio",
    calculationRuleId: "fixed_operating_costs_div_monthly_average_sales",
  },
  problem_specificity: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "problem_specificity",
    calculationRuleId: "rubric_problem_specificity_dev_v1",
  },
  self_plan_exists: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "self_plan_exists",
    calculationRuleId: "canonical_plan_exists",
  },
  plan_action_count: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "plan_action_count",
    calculationRuleId: "canonical_plan_action_count",
  },
  plan_specificity: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "plan_specificity",
    calculationRuleId: "rubric_plan_specificity_dev_v1",
  },
  plan_time_bound: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "plan_time_bound",
    calculationRuleId: "canonical_plan_schedule_present",
  },
  plan_measurability: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "plan_measurability",
    calculationRuleId: "canonical_plan_measure_present",
  },
  execution_readiness: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "execution_readiness",
    calculationRuleId: "canonical_execution_readiness",
  },
  obstacle_awareness: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "obstacle_awareness",
    calculationRuleId: "canonical_execution_blockers_present",
  },
  evidence_readiness: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "evidence_readiness",
    calculationRuleId: "canonical_evidence_readiness",
  },
  past_execution_example_count: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "past_execution_example_count",
    calculationRuleId: "canonical_past_execution_example_count_alias",
  },
  confirmed_order_value: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "confirmed_order_value",
    calculationRuleId: "canonical_confirmed_order_value",
  },
  booking_coverage_weeks: {
    implementationState: "PARTIAL",
    runtimeFeatureName: "booking_coverage_weeks",
    calculationRuleId: "confirmed_zero_booking_coverage_only",
  },
  booking_count: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "booking_count",
    calculationRuleId: "canonical_confirmed_reservation_count_4w_alias",
  },
  season_adjusted_growth: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "season_adjusted_growth",
    calculationRuleId: "borrower_growth_with_historical_basis",
  },
  demand_visibility: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "demand_visibility",
    calculationRuleId: "reservation_and_nonexpectation_basis",
  },
  essential_household_expense: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "essential_household_expense",
    calculationRuleId: "canonical_essential_living_expense_alias",
  },
  household_buffer_months: {
    implementationState: "IMPLEMENTED",
    runtimeFeatureName: "household_buffer_months",
    calculationRuleId: "canonical_buffer_months_alias",
  },
} as const satisfies Partial<Record<RequiredNamedFeatureCode, FeatureImplementation>>;

export interface NamedFeatureCatalogEntry {
  catalogVersion: typeof NAMED_FEATURE_CATALOG_VERSION;
  code: RequiredNamedFeatureCode;
  label: string;
  domain: InformationCategory;
  implementationState: NamedFeatureImplementationState;
  runtimeFeatureName: RequiredNamedFeatureCode | null;
  calculationRuleId: string | null;
  modelCandidate: false;
  defaultValue: null;
  missingValue: null;
  missingPolicy: "PROPAGATE_MISSING";
  prohibitedFallback: "NEVER_COERCE_TO_ZERO";
}

const featureRows: readonly (readonly [RequiredNamedFeatureCode, string, InformationCategory])[] = [
  ...CURRENT_STATE_FEATURES.map(([code, label]) => [code, label, "CURRENT_STATE"] as const),
  ...IMPROVEMENT_INTENT_FEATURES.map(([code, label]) => [code, label, "IMPROVEMENT_INTENT"] as const),
  ...FUTURE_OUTLOOK_FEATURES.map(([code, label]) => [code, label, "FUTURE_OUTLOOK"] as const),
  ...HOUSEHOLD_STATE_FEATURES.map(([code, label]) => [code, label, "HOUSEHOLD_STATE"] as const),
];

function implementationFor(code: RequiredNamedFeatureCode): FeatureImplementation | null {
  return Object.prototype.hasOwnProperty.call(FEATURE_IMPLEMENTATIONS, code)
    ? FEATURE_IMPLEMENTATIONS[code as keyof typeof FEATURE_IMPLEMENTATIONS]
    : null;
}

export const NAMED_FEATURE_CATALOG: readonly NamedFeatureCatalogEntry[] = featureRows.map(
  ([code, label, domain]) => {
    const implementation = implementationFor(code);
    return {
      catalogVersion: NAMED_FEATURE_CATALOG_VERSION,
      code,
      label,
      domain,
      implementationState: implementation?.implementationState ?? "MISSING",
      runtimeFeatureName: implementation?.runtimeFeatureName ?? null,
      calculationRuleId: implementation?.calculationRuleId ?? null,
      modelCandidate: false,
      defaultValue: null,
      missingValue: null,
      missingPolicy: "PROPAGATE_MISSING",
      prohibitedFallback: "NEVER_COERCE_TO_ZERO",
    };
  },
);

export interface NamedFeatureRuntimeObservation {
  name: string;
  state: "COMPUTED" | "MISSING" | "NOT_CALCULABLE";
  raw: unknown;
}

export interface NamedFeatureCoverageItem {
  code: RequiredNamedFeatureCode;
  implementationState: NamedFeatureImplementationState;
  observationState: "COMPUTED" | "MISSING" | "NOT_CALCULABLE";
  value: unknown | null;
  modelCandidate: false;
  catalogVersion: typeof NAMED_FEATURE_CATALOG_VERSION;
}

/**
 * Projects runtime observations onto the complete named feature contract.
 * Catalog-only and absent values remain null; only an explicit COMPUTED zero is retained as zero.
 */
export function buildNamedFeatureCoverage(
  observations: readonly NamedFeatureRuntimeObservation[],
): NamedFeatureCoverageItem[] {
  const byName = new Map(observations.map((observation) => [observation.name, observation]));
  return NAMED_FEATURE_CATALOG.map((definition) => {
    const observation = definition.runtimeFeatureName
      ? byName.get(definition.runtimeFeatureName)
      : undefined;
    const observationState =
      definition.implementationState === "MISSING"
        ? "MISSING"
        : observation?.state ?? "MISSING";
    return {
      code: definition.code,
      implementationState: definition.implementationState,
      observationState,
      value: observationState === "COMPUTED" ? observation?.raw ?? null : null,
      modelCandidate: false,
      catalogVersion: NAMED_FEATURE_CATALOG_VERSION,
    };
  });
}

export function getNamedFeatureCatalogEntry(
  code: string,
): NamedFeatureCatalogEntry | null {
  return NAMED_FEATURE_CATALOG.find((entry) => entry.code === code) ?? null;
}

export function validateNamedFeatureCatalog(
  catalog: readonly NamedFeatureCatalogEntry[] = NAMED_FEATURE_CATALOG,
): string[] {
  const issues: string[] = [];
  const expected = new Set<string>(REQUIRED_NAMED_FEATURE_CODES);
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (seen.has(entry.code)) issues.push(`duplicate feature code: ${entry.code}`);
    seen.add(entry.code);
    if (!expected.has(entry.code)) issues.push(`unknown feature code: ${entry.code}`);
    if (entry.catalogVersion !== NAMED_FEATURE_CATALOG_VERSION) {
      issues.push(`invalid catalog version: ${entry.code}`);
    }
    if (entry.modelCandidate !== false) issues.push(`modelCandidate must be false: ${entry.code}`);
    if (entry.defaultValue !== null || entry.missingValue !== null) {
      issues.push(`feature defaults must be null: ${entry.code}`);
    }
    if (entry.prohibitedFallback !== "NEVER_COERCE_TO_ZERO") {
      issues.push(`zero fallback is prohibited: ${entry.code}`);
    }
    if (entry.implementationState === "MISSING") {
      if (entry.runtimeFeatureName !== null || entry.calculationRuleId !== null) {
        issues.push(`missing feature must not claim a runtime rule: ${entry.code}`);
      }
    } else if (!entry.runtimeFeatureName || !entry.calculationRuleId) {
      issues.push(`implemented feature requires a runtime rule: ${entry.code}`);
    }
  }
  for (const code of expected) {
    if (!seen.has(code)) issues.push(`missing required feature code: ${code}`);
  }
  return issues;
}
