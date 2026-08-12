import {
  selectedRevision,
  type CanonicalInformationRecord,
  type CanonicalInformationValue,
  type DurationValue,
  type NumericMeasure,
} from "./information-values";

/**
 * Model-ready, but deliberately model-agnostic, feature contract.  The
 * existing application has no trained scoring model, so this artifact is used
 * for explanations and future offline training rather than approval decisions.
 */
export const FEATURE_SCHEMA_V2_VERSION = "feature_schema_v2" as const;

export type FeatureV2Group =
  | "business"
  | "financial"
  | "credit"
  | "operation"
  | "owner"
  | "external"
  | "improvement";

export type FeatureV2Dtype = "float" | "integer" | "boolean" | "category";
export type FeatureV2Direction =
  | "positive_is_improvement"
  | "negative_is_improvement"
  | "context_only";
export type FeatureV2State = "COMPUTED" | "MISSING" | "NOT_CALCULABLE";
export type FeatureV2Primitive = number | boolean | string | null;

export interface FeatureV2Definition {
  name: string;
  group: FeatureV2Group;
  dtype: FeatureV2Dtype;
  description: string;
  source: string;
  window: "3m" | "6m" | "12m" | null;
  missingPolicy: "null_safe";
  direction: FeatureV2Direction;
  required: false;
  version: typeof FEATURE_SCHEMA_V2_VERSION;
  modelCandidate: false;
}

export interface FeatureV2Value {
  name: string;
  group: FeatureV2Group;
  dtype: FeatureV2Dtype;
  state: FeatureV2State;
  value: FeatureV2Primitive;
  sourceFeatures: string[];
  calculation: string | null;
  reason: string;
  version: typeof FEATURE_SCHEMA_V2_VERSION;
  modelCandidate: false;
}

export interface FeatureV2Set {
  schemaVersion: typeof FEATURE_SCHEMA_V2_VERSION;
  enabled: boolean;
  features: FeatureV2Value[];
}

export interface FeatureV2Input {
  /**
   * Flat, typed source values keyed by the dictionary name. Unknown keys are
   * ignored so an upstream payload can evolve without becoming a breaking API.
   */
  raw: Readonly<Record<string, unknown>>;
  /** Optional interface only; no paid API or crawler is introduced by v2. */
  external?: ExternalContextFeatureInput | null;
}

export interface ExternalContextFeatureInput {
  ext_peer_sales_growth_3m?: number | null;
  ext_peer_sales_volatility_6m?: number | null;
  ext_peer_marketing_cost_ratio?: number | null;
  ext_peer_fixed_cost_ratio?: number | null;
  ext_peer_repeat_customer_ratio?: number | null;
  ext_sales_growth_gap_peer?: number | null;
  ext_cost_ratio_gap_peer?: number | null;
  ext_foot_traffic_change_3m?: number | null;
  ext_competitor_count_change_6m?: number | null;
  ext_industry_growth_6m?: number | null;
  ext_industry_volatility_12m?: number | null;
  ext_industry_seasonality?: number | null;
}

interface FeatureRow {
  name: string;
  dtype: FeatureV2Dtype;
  description: string;
  source: string;
  window?: FeatureV2Definition["window"];
  direction?: FeatureV2Direction;
}

function rows(group: FeatureV2Group, values: readonly FeatureRow[]): FeatureV2Definition[] {
  return values.map((value) => ({
    name: value.name,
    group,
    dtype: value.dtype,
    description: value.description,
    source: value.source,
    window: value.window ?? null,
    missingPolicy: "null_safe",
    direction: value.direction ?? "context_only",
    required: false,
    version: FEATURE_SCHEMA_V2_VERSION,
    modelCandidate: false,
  }));
}

const BUSINESS_FEATURES = rows("business", [
  { name: "biz_industry_code", dtype: "category", description: "업종 코드", source: "business_profile" },
  { name: "biz_business_age_months", dtype: "integer", description: "사업 업력(개월)", source: "business_profile", direction: "positive_is_improvement" },
  { name: "biz_store_count", dtype: "integer", description: "사업장 수", source: "business_profile" },
  { name: "biz_employee_count", dtype: "integer", description: "종업원 수", source: "business_profile" },
  { name: "biz_active_months_12m", dtype: "integer", description: "최근 12개월 영업월 수", source: "sales_history", window: "12m", direction: "positive_is_improvement" },
  { name: "biz_sales_active_month_ratio_12m", dtype: "float", description: "최근 12개월 매출 발생월 비율", source: "sales_history", window: "12m", direction: "positive_is_improvement" },
  { name: "biz_zero_sales_month_count_12m", dtype: "integer", description: "최근 12개월 매출 0월 수", source: "sales_history", window: "12m", direction: "negative_is_improvement" },
  { name: "biz_consecutive_active_months", dtype: "integer", description: "연속 영업 개월", source: "sales_history", direction: "positive_is_improvement" },
  { name: "biz_recent_activity_flag", dtype: "boolean", description: "최근 영업 활동 여부", source: "sales_history", direction: "positive_is_improvement" },
  { name: "biz_sales_recovery_from_min_6m", dtype: "float", description: "6개월 저점 대비 매출 회복률", source: "sales_history", window: "6m", direction: "positive_is_improvement" },
  { name: "biz_positive_growth_month_count_6m", dtype: "integer", description: "6개월 양(+) 성장월 수", source: "sales_history", window: "6m", direction: "positive_is_improvement" },
  { name: "biz_sales_cv_6m", dtype: "float", description: "6개월 매출 변동계수", source: "sales_history", window: "6m", direction: "negative_is_improvement" },
]);

const FINANCIAL_FEATURES = rows("financial", [
  { name: "fin_sales_avg_3m", dtype: "float", description: "최근 3개월 평균 매출", source: "card_sales", window: "3m", direction: "positive_is_improvement" },
  { name: "fin_sales_avg_6m", dtype: "float", description: "최근 6개월 평균 매출", source: "card_sales", window: "6m", direction: "positive_is_improvement" },
  { name: "fin_sales_avg_12m", dtype: "float", description: "최근 12개월 평균 매출", source: "card_sales", window: "12m", direction: "positive_is_improvement" },
  { name: "fin_sales_growth_3m", dtype: "float", description: "최근 3개월 매출 증가율", source: "card_sales", window: "3m", direction: "positive_is_improvement" },
  { name: "fin_sales_growth_6m", dtype: "float", description: "최근 6개월 매출 증가율", source: "card_sales", window: "6m", direction: "positive_is_improvement" },
  { name: "fin_sales_trend_slope_6m", dtype: "float", description: "최근 6개월 매출 추세 기울기", source: "card_sales", window: "6m", direction: "positive_is_improvement" },
  { name: "fin_sales_volatility_6m", dtype: "float", description: "최근 6개월 매출 변동성", source: "card_sales", window: "6m", direction: "negative_is_improvement" },
  { name: "fin_avg_month_end_balance_3m", dtype: "float", description: "최근 3개월 월말 잔액 평균", source: "account_transaction", window: "3m", direction: "positive_is_improvement" },
  { name: "fin_min_month_end_balance_6m", dtype: "float", description: "최근 6개월 월말 잔액 최저값", source: "account_transaction", window: "6m", direction: "positive_is_improvement" },
  { name: "fin_month_end_balance_growth_3m", dtype: "float", description: "최근 3개월 월말 잔액 증가율", source: "account_transaction", window: "3m", direction: "positive_is_improvement" },
  { name: "fin_cash_inflow_avg_3m", dtype: "float", description: "최근 3개월 현금 유입 평균", source: "account_transaction", window: "3m", direction: "positive_is_improvement" },
  { name: "fin_cash_outflow_avg_3m", dtype: "float", description: "최근 3개월 현금 유출 평균", source: "account_transaction", window: "3m", direction: "negative_is_improvement" },
  { name: "fin_net_cashflow_avg_3m", dtype: "float", description: "최근 3개월 순현금흐름 평균", source: "account_transaction", window: "3m", direction: "positive_is_improvement" },
  { name: "fin_net_cashflow_positive_month_ratio_6m", dtype: "float", description: "최근 6개월 순현금흐름 양수월 비율", source: "account_transaction", window: "6m", direction: "positive_is_improvement" },
  { name: "fin_cashflow_trend_slope_6m", dtype: "float", description: "최근 6개월 현금흐름 추세", source: "account_transaction", window: "6m", direction: "positive_is_improvement" },
  { name: "fin_cashflow_deficit_month_count_6m", dtype: "integer", description: "최근 6개월 현금흐름 적자월 수", source: "account_transaction", window: "6m", direction: "negative_is_improvement" },
  { name: "fin_cash_buffer_days_est", dtype: "float", description: "추정 현금 버퍼 일수", source: "account_transaction", direction: "positive_is_improvement" },
  { name: "fin_fixed_cost_ratio", dtype: "float", description: "고정비/매출 비율", source: "financial_statement", direction: "negative_is_improvement" },
  { name: "fin_marketing_cost_ratio", dtype: "float", description: "마케팅비/매출 비율", source: "financial_statement", direction: "context_only" },
  { name: "fin_interest_cost_ratio", dtype: "float", description: "이자비용/매출 비율", source: "financial_statement", direction: "negative_is_improvement" },
  { name: "fin_fixed_cost_gap_peer", dtype: "float", description: "유사업체 대비 고정비 비율 차이", source: "peer_context", direction: "context_only" },
  { name: "fin_marketing_cost_gap_peer", dtype: "float", description: "유사업체 대비 마케팅비 비율 차이", source: "peer_context", direction: "context_only" },
  { name: "fin_cashflow_to_sales_ratio", dtype: "float", description: "순현금흐름/매출 비율", source: "account_transaction", direction: "positive_is_improvement" },
]);

const CREDIT_FEATURES = rows("credit", [
  { name: "crd_total_debt", dtype: "float", description: "총 채무", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_high_interest_debt", dtype: "float", description: "고금리 채무", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_monthly_debt_payment", dtype: "float", description: "월 채무 상환액", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_delinquency_count_12m", dtype: "integer", description: "12개월 연체 횟수", source: "credit_data", window: "12m", direction: "negative_is_improvement" },
  { name: "crd_delinquency_days_12m", dtype: "integer", description: "12개월 연체 일수", source: "credit_data", window: "12m", direction: "negative_is_improvement" },
  { name: "crd_current_delinquency_flag", dtype: "boolean", description: "현재 연체 여부", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_credit_utilization", dtype: "float", description: "신용 한도 사용률", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_credit_score", dtype: "float", description: "공식 신용점수 원천값", source: "credit_data", direction: "context_only" },
  { name: "crd_debt_to_sales_ratio", dtype: "float", description: "채무/매출 비율", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_payment_to_sales_ratio", dtype: "float", description: "상환액/매출 비율", source: "credit_data", direction: "negative_is_improvement" },
  { name: "crd_total_debt_change_3m", dtype: "float", description: "3개월 총 채무 변화", source: "credit_data", window: "3m", direction: "negative_is_improvement" },
  { name: "crd_high_interest_debt_change_3m", dtype: "float", description: "3개월 고금리 채무 변화", source: "credit_data", window: "3m", direction: "negative_is_improvement" },
  { name: "crd_credit_utilization_change_3m", dtype: "float", description: "3개월 한도 사용률 변화", source: "credit_data", window: "3m", direction: "negative_is_improvement" },
  { name: "crd_delinquency_recovery_trend", dtype: "float", description: "연체 회복 추세", source: "credit_data", window: "6m", direction: "positive_is_improvement" },
  { name: "crd_consecutive_months_no_delinquency", dtype: "integer", description: "연속 무연체 개월", source: "credit_data", direction: "positive_is_improvement" },
]);

const OPERATION_FEATURES = rows("operation", [
  { name: "ops_sales_per_employee", dtype: "float", description: "직원 1인당 매출", source: "operation_data", direction: "context_only" },
  { name: "ops_sales_per_store", dtype: "float", description: "매장 1곳당 매출", source: "operation_data", direction: "context_only" },
  { name: "ops_labor_cost_efficiency", dtype: "float", description: "인건비 효율", source: "operation_data", direction: "positive_is_improvement" },
  { name: "ops_marketing_roi_proxy", dtype: "float", description: "마케팅 ROI 대용치", source: "operation_data", direction: "positive_is_improvement" },
  { name: "ops_repeat_customer_ratio", dtype: "float", description: "반복고객 비중", source: "interview_or_customer_data", direction: "positive_is_improvement" },
  { name: "ops_online_sales_ratio", dtype: "float", description: "온라인 매출 비중", source: "operation_data", direction: "context_only" },
  { name: "ops_digital_payment_ratio", dtype: "float", description: "디지털 결제 비중", source: "operation_data", direction: "context_only" },
  { name: "ops_top_product_sales_ratio", dtype: "float", description: "상위 상품 매출 비중", source: "operation_data", direction: "context_only" },
  { name: "ops_top_channel_sales_ratio", dtype: "float", description: "상위 채널 매출 비중", source: "operation_data", direction: "context_only" },
  { name: "ops_business_personal_account_separation_ratio", dtype: "float", description: "사업·개인 계좌 분리 비율", source: "operation_data", direction: "positive_is_improvement" },
]);

const OWNER_FEATURES = rows("owner", [
  { name: "own_primary_problem_category", dtype: "category", description: "사장님이 말한 주된 문제 범주", source: "interview_structured" },
  { name: "own_secondary_problem_category", dtype: "category", description: "사장님이 말한 부차 문제 범주", source: "interview_structured" },
  { name: "own_problem_self_awareness_score", dtype: "float", description: "문제 인식의 관측 구체성", source: "interview_structured", direction: "context_only" },
  { name: "own_problem_cause_specificity", dtype: "float", description: "원인 설명 구체성", source: "interview_structured", direction: "context_only" },
  { name: "own_prior_action_count", dtype: "integer", description: "사전 실행 행동 수", source: "interview_structured", direction: "context_only" },
  { name: "own_prior_action_success_count", dtype: "integer", description: "성공으로 확인된 사전 행동 수", source: "interview_structured", direction: "context_only" },
  { name: "own_prior_action_failure_count", dtype: "integer", description: "실패로 확인된 사전 행동 수", source: "interview_structured", direction: "context_only" },
  { name: "own_goal_category", dtype: "category", description: "사장님이 선택한 목표 범주", source: "interview_structured" },
  { name: "own_goal_target_value", dtype: "float", description: "사장님이 말한 목표 수치", source: "interview_structured", direction: "context_only" },
  { name: "own_goal_target_unit", dtype: "category", description: "목표 수치 단위", source: "interview_structured" },
  { name: "own_goal_horizon_days", dtype: "integer", description: "목표 기간(일)", source: "interview_structured", direction: "context_only" },
  { name: "own_goal_self_selected_flag", dtype: "boolean", description: "사장님 직접 선택 목표 여부", source: "interview_structured", direction: "context_only" },
  { name: "own_plan_action_category", dtype: "category", description: "사장님 계획 행동 범주", source: "interview_structured" },
  { name: "own_plan_start_date", dtype: "category", description: "사장님이 말한 계획 시작일", source: "interview_structured" },
  { name: "own_plan_horizon_days", dtype: "integer", description: "사장님 계획 기간(일)", source: "interview_structured", direction: "context_only" },
  { name: "own_plan_budget", dtype: "float", description: "사장님이 말한 실행 예산", source: "interview_structured", direction: "context_only" },
  { name: "own_plan_weekly_time_hours", dtype: "float", description: "주당 가용 실행시간", source: "interview_structured", direction: "context_only" },
  { name: "own_plan_measurement_metric", dtype: "category", description: "사장님이 정한 확인 지표", source: "interview_structured" },
  { name: "own_plan_constraint_count", dtype: "integer", description: "사장님이 말한 실행 제약 수", source: "interview_structured", direction: "context_only" },
  { name: "own_plan_specificity_score", dtype: "float", description: "계획 요소 관측 충족도", source: "derived_interview" },
]);

const EXTERNAL_FEATURES = rows("external", [
  { name: "ext_peer_sales_growth_3m", dtype: "float", description: "유사업체 3개월 매출 성장", source: "peer_context", window: "3m", direction: "context_only" },
  { name: "ext_peer_sales_volatility_6m", dtype: "float", description: "유사업체 6개월 매출 변동성", source: "peer_context", window: "6m", direction: "context_only" },
  { name: "ext_peer_marketing_cost_ratio", dtype: "float", description: "유사업체 마케팅비 비율", source: "peer_context", direction: "context_only" },
  { name: "ext_peer_fixed_cost_ratio", dtype: "float", description: "유사업체 고정비 비율", source: "peer_context", direction: "context_only" },
  { name: "ext_peer_repeat_customer_ratio", dtype: "float", description: "유사업체 반복고객 비중", source: "peer_context", direction: "context_only" },
  { name: "ext_sales_growth_gap_peer", dtype: "float", description: "유사업체 대비 매출 성장 차이", source: "derived_peer_context", direction: "context_only" },
  { name: "ext_cost_ratio_gap_peer", dtype: "float", description: "유사업체 대비 비용 비율 차이", source: "derived_peer_context", direction: "context_only" },
  { name: "ext_foot_traffic_change_3m", dtype: "float", description: "3개월 유동인구 변화", source: "external_context", window: "3m", direction: "context_only" },
  { name: "ext_competitor_count_change_6m", dtype: "float", description: "6개월 경쟁업체 수 변화", source: "external_context", window: "6m", direction: "context_only" },
  { name: "ext_industry_growth_6m", dtype: "float", description: "6개월 업종 성장", source: "external_context", window: "6m", direction: "context_only" },
  { name: "ext_industry_volatility_12m", dtype: "float", description: "12개월 업종 변동성", source: "external_context", window: "12m", direction: "context_only" },
  { name: "ext_industry_seasonality", dtype: "float", description: "업종 계절성", source: "external_context", direction: "context_only" },
]);

const IMPROVEMENT_FEATURES = rows("improvement", [
  { name: "imp_recovery_momentum", dtype: "float", description: "회복 모멘텀의 관측 신호", source: "derived_v2", direction: "positive_is_improvement" },
  { name: "imp_cashflow_stabilization", dtype: "float", description: "현금흐름 안정화 관측 신호", source: "derived_v2", direction: "positive_is_improvement" },
  { name: "imp_cost_adjustment_headroom", dtype: "float", description: "비용 조정 여지의 관측 신호", source: "derived_v2", direction: "positive_is_improvement" },
  { name: "imp_sales_recovery_potential", dtype: "float", description: "매출 회복 가능성의 관측 신호", source: "derived_v2", direction: "positive_is_improvement" },
  { name: "imp_plan_specificity", dtype: "float", description: "목표·기간·예산·측정·제약의 명시성", source: "derived_v2", direction: "context_only" },
  { name: "imp_plan_feasibility", dtype: "float", description: "계획 현실성 판단에 필요한 관측 입력 충족도", source: "derived_v2", direction: "context_only" },
  { name: "imp_goal_problem_alignment", dtype: "float", description: "문제와 목표의 관측된 범주 정합성", source: "derived_v2", direction: "context_only" },
  { name: "imp_overall_improvement_signal", dtype: "float", description: "개선가능성 설명용 종합 신호", source: "derived_v2", direction: "context_only" },
]);

export const FEATURES_V2 = {
  business: BUSINESS_FEATURES,
  financial: FINANCIAL_FEATURES,
  credit: CREDIT_FEATURES,
  operation: OPERATION_FEATURES,
  owner: OWNER_FEATURES,
  external: EXTERNAL_FEATURES,
  improvement: IMPROVEMENT_FEATURES,
} as const;

export const FEATURE_DICTIONARY_V2: readonly FeatureV2Definition[] = Object.freeze(
  Object.values(FEATURES_V2).flat(),
);

const DERIVED_FEATURES = new Set(IMPROVEMENT_FEATURES.map((feature) => feature.name));
const FEATURE_BY_NAME = new Map(FEATURE_DICTIONARY_V2.map((feature) => [feature.name, feature]));

function missing(definition: FeatureV2Definition, reason: string): FeatureV2Value {
  return {
    name: definition.name,
    group: definition.group,
    dtype: definition.dtype,
    state: "MISSING",
    value: null,
    sourceFeatures: [],
    calculation: null,
    reason,
    version: FEATURE_SCHEMA_V2_VERSION,
    modelCandidate: false,
  };
}

function calculated(
  definition: FeatureV2Definition,
  value: number,
  sourceFeatures: string[],
  calculation: string,
  reason: string,
): FeatureV2Value {
  return {
    name: definition.name,
    group: definition.group,
    dtype: definition.dtype,
    state: "COMPUTED",
    value: Math.max(0, Math.min(1, value)),
    sourceFeatures,
    calculation,
    reason,
    version: FEATURE_SCHEMA_V2_VERSION,
    modelCandidate: false,
  };
}

function rawValue(definition: FeatureV2Definition, value: unknown): FeatureV2Value {
  const base = {
    name: definition.name,
    group: definition.group,
    dtype: definition.dtype,
    sourceFeatures: [definition.name],
    calculation: null,
    version: FEATURE_SCHEMA_V2_VERSION,
    modelCandidate: false as const,
  };
  if (value === null || value === undefined) {
    return { ...missing(definition, "원천값이 제공되지 않았습니다."), sourceFeatures: [definition.name] };
  }
  if (definition.dtype === "boolean") {
    if (typeof value !== "boolean") return missing(definition, "boolean 원천값이 아닙니다.");
    return { ...base, state: "COMPUTED", value, reason: "제공된 원천 boolean 값입니다." };
  }
  if (definition.dtype === "category") {
    if (typeof value !== "string" || !value.trim()) return missing(definition, "비어 있거나 잘못된 category 원천값입니다.");
    return { ...base, state: "COMPUTED", value: value.trim(), reason: "제공된 원천 category 값입니다." };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return missing(definition, "유한한 numeric 원천값이 아닙니다.");
  }
  if (definition.dtype === "integer" && !Number.isInteger(value)) {
    return missing(definition, "integer 원천값이 아닙니다.");
  }
  return { ...base, state: "COMPUTED", value, reason: "제공된 원천 numeric 값입니다." };
}

function numeric(features: ReadonlyMap<string, FeatureV2Value>, name: string): number | null {
  const value = features.get(name);
  return value?.state === "COMPUTED" && typeof value.value === "number" ? value.value : null;
}

function present(features: ReadonlyMap<string, FeatureV2Value>, name: string): boolean {
  const value = features.get(name);
  return value?.state === "COMPUTED" && value.value !== null;
}

function category(features: ReadonlyMap<string, FeatureV2Value>, name: string): string | null {
  const value = features.get(name)?.value;
  return typeof value === "string" ? value : null;
}

function boundedPositive(value: number, scale: number): number {
  return Math.max(0, Math.min(1, value / scale));
}

function boundedInverse(value: number, scale: number): number {
  return 1 - boundedPositive(Math.max(0, value), scale);
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function derived(
  features: Map<string, FeatureV2Value>,
  name: string,
  components: Array<{ source: string; value: number | null }>,
  formula: string,
  reason: string,
): void {
  const definition = FEATURE_BY_NAME.get(name)!;
  const available = components.filter((component) => component.value !== null) as Array<{ source: string; value: number }>;
  if (available.length === 0) {
    features.set(name, missing(definition, "파생 계산에 사용할 원천값이 없습니다."));
    return;
  }
  features.set(
    name,
    calculated(
      definition,
      average(available.map((component) => component.value))!,
      available.map((component) => component.source),
      formula,
      reason,
    ),
  );
}

function alignment(problem: string | null, goal: string | null): number | null {
  if (!problem || !goal) return null;
  const expected: Readonly<Record<string, readonly string[]>> = {
    sales_decline: ["sales_growth", "customer_expansion", "revenue_recovery"],
    cost_burden: ["cost_reduction", "marketing_cost_reduction", "cashflow_stabilization"],
    cashflow_instability: ["cashflow_stabilization", "cost_reduction"],
    customer_decline: ["customer_expansion", "repeat_customer_growth", "sales_growth"],
    debt_burden: ["debt_reduction", "cashflow_stabilization"],
    operation_efficiency: ["operation_efficiency", "cost_reduction"],
  };
  const candidates = expected[problem];
  return candidates ? (candidates.includes(goal) ? 1 : 0) : null;
}

/** One source of truth used by both an offline training export and inference/report flows. */
export function buildFeatureV2(input: FeatureV2Input, options: { enabled?: boolean } = {}): FeatureV2Set {
  const enabled = options.enabled ?? true;
  const source: Record<string, unknown> = { ...input.raw, ...(input.external ?? {}) };
  const map = new Map<string, FeatureV2Value>();
  for (const definition of FEATURE_DICTIONARY_V2) {
    map.set(
      definition.name,
      enabled
        ? DERIVED_FEATURES.has(definition.name)
          ? missing(definition, "파생 계산 전입니다.")
          : rawValue(definition, source[definition.name])
        : missing(definition, "feature_schema_v2가 비활성화되어 있습니다."),
    );
  }
  if (!enabled) {
    return { schemaVersion: FEATURE_SCHEMA_V2_VERSION, enabled, features: FEATURE_DICTIONARY_V2.map((item) => map.get(item.name)!) };
  }

  derived(map, "imp_recovery_momentum", [
    { source: "fin_sales_growth_3m", value: nullableMap(numeric(map, "fin_sales_growth_3m"), (value) => boundedPositive(value, 0.2)) },
    { source: "fin_cashflow_trend_slope_6m", value: nullableMap(numeric(map, "fin_cashflow_trend_slope_6m"), (value) => boundedPositive(value, 0.2)) },
    { source: "fin_month_end_balance_growth_3m", value: nullableMap(numeric(map, "fin_month_end_balance_growth_3m"), (value) => boundedPositive(value, 0.2)) },
    { source: "crd_delinquency_recovery_trend", value: nullableMap(numeric(map, "crd_delinquency_recovery_trend"), (value) => boundedPositive(value, 1)) },
    { source: "biz_recent_activity_flag", value: booleanAsNumber(map.get("biz_recent_activity_flag")?.value) },
  ], "mean(normalized sales, cashflow, balance, delinquency recovery, activity signals)", "현재 상태의 좋고 나쁨이 아니라 관측된 최근 회복 방향을 요약합니다.");

  derived(map, "imp_cashflow_stabilization", [
    { source: "fin_month_end_balance_growth_3m", value: nullableMap(numeric(map, "fin_month_end_balance_growth_3m"), (value) => boundedPositive(value, 0.2)) },
    { source: "fin_net_cashflow_positive_month_ratio_6m", value: numeric(map, "fin_net_cashflow_positive_month_ratio_6m") },
    { source: "fin_cashflow_deficit_month_count_6m", value: nullableMap(numeric(map, "fin_cashflow_deficit_month_count_6m"), (value) => boundedInverse(value, 6)) },
    { source: "crd_payment_to_sales_ratio", value: nullableMap(numeric(map, "crd_payment_to_sales_ratio"), (value) => boundedInverse(value, 1)) },
  ], "mean(balance recovery, positive cashflow share, inverse deficit count, inverse payment burden)", "현금흐름 안정화에 관련된 관측 신호만 요약합니다.");

  const costPlanSignal = ["cost_reduction", "marketing_cost_reduction", "cashflow_stabilization"].includes(category(map, "own_goal_category") ?? "") ? 1 : null;
  derived(map, "imp_cost_adjustment_headroom", [
    { source: "fin_fixed_cost_gap_peer", value: nullableMap(numeric(map, "fin_fixed_cost_gap_peer"), (value) => boundedPositive(value, 0.3)) },
    { source: "fin_marketing_cost_gap_peer", value: nullableMap(numeric(map, "fin_marketing_cost_gap_peer"), (value) => boundedPositive(value, 0.3)) },
    { source: "fin_interest_cost_ratio", value: nullableMap(numeric(map, "fin_interest_cost_ratio"), (value) => boundedPositive(value, 0.2)) },
    { source: "own_goal_category", value: costPlanSignal },
  ], "mean(peer cost gaps, interest burden, owner-selected cost plan signal)", "비용이 높다는 단정이 아니라, 근거와 사장님 계획이 함께 있을 때 조정 가능 영역을 표현합니다.");

  derived(map, "imp_sales_recovery_potential", [
    { source: "biz_sales_recovery_from_min_6m", value: nullableMap(numeric(map, "biz_sales_recovery_from_min_6m"), (value) => boundedPositive(value, 0.5)) },
    { source: "ops_repeat_customer_ratio", value: numeric(map, "ops_repeat_customer_ratio") },
    { source: "fin_sales_growth_3m", value: nullableMap(numeric(map, "fin_sales_growth_3m"), (value) => boundedPositive(value, 0.2)) },
    { source: "ext_sales_growth_gap_peer", value: nullableMap(numeric(map, "ext_sales_growth_gap_peer"), (value) => boundedPositive(value, 0.2)) },
  ], "mean(recovery from low, repeat demand, sales growth, peer-adjusted growth)", "매출 수준이 아니라 회복을 뒷받침하는 관측 신호를 요약합니다.");

  const planPresence = [
    "own_goal_target_value",
    "own_goal_horizon_days",
    "own_plan_budget",
    "own_plan_measurement_metric",
    "own_plan_start_date",
    "own_plan_constraint_count",
  ].map((name) => ({ source: name, value: present(map, name) ? 1 : null }));
  derived(map, "imp_plan_specificity", planPresence, "count(present goal, horizon, budget, metric, start date, constraints) / available elements", "사장님이 직접 말한 계획 요소의 명시성만 표현하며 성격이나 의지를 점수화하지 않습니다.");

  const feasibilityPresence = [
    "own_goal_target_value",
    "own_goal_horizon_days",
    "own_plan_horizon_days",
    "own_plan_budget",
    "own_plan_weekly_time_hours",
    "own_plan_constraint_count",
  ].map((name) => ({ source: name, value: present(map, name) ? 1 : null }));
  derived(map, "imp_plan_feasibility", feasibilityPresence, "count(observed target, timing, resources, constraints) / available elements", "성공 확률이 아니라 현실성 검토에 필요한 사장님 직접 진술 입력의 충족도입니다.");

  const problem = category(map, "own_primary_problem_category");
  const goal = category(map, "own_goal_category");
  const alignmentValue = alignment(problem, goal);
  const alignmentDefinition = FEATURE_BY_NAME.get("imp_goal_problem_alignment")!;
  map.set(
    "imp_goal_problem_alignment",
    alignmentValue === null
      ? missing(alignmentDefinition, "문제 범주와 목표 범주가 모두 직접 구조화되어야 정합성을 계산합니다.")
      : calculated(alignmentDefinition, alignmentValue, ["own_primary_problem_category", "own_goal_category"], "category compatibility table", "사장님 문제·목표 범주의 사전 정의된 연결만 표현합니다."),
  );

  derived(map, "imp_overall_improvement_signal", [
    { source: "imp_recovery_momentum", value: numeric(map, "imp_recovery_momentum") },
    { source: "imp_cashflow_stabilization", value: numeric(map, "imp_cashflow_stabilization") },
    { source: "imp_cost_adjustment_headroom", value: numeric(map, "imp_cost_adjustment_headroom") },
    { source: "imp_sales_recovery_potential", value: numeric(map, "imp_sales_recovery_potential") },
    { source: "imp_plan_specificity", value: numeric(map, "imp_plan_specificity") },
    { source: "imp_plan_feasibility", value: numeric(map, "imp_plan_feasibility") },
  ], "mean(computed improvement explanations)", "신용점수나 승인판단이 아닌 UI·설명용 개선가능성 종합 신호입니다.");

  return {
    schemaVersion: FEATURE_SCHEMA_V2_VERSION,
    enabled,
    features: FEATURE_DICTIONARY_V2.map((definition) => map.get(definition.name)!),
  };
}

function nullableMap(value: number | null, mapper: (value: number) => number): number | null {
  return value === null ? null : mapper(value);
}

function booleanAsNumber(value: FeatureV2Primitive | undefined): number | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

/** Explicit aliases make train/inference parity testable without two formulas. */
export const buildTrainingFeatureV2 = buildFeatureV2;
export const buildInferenceFeatureV2 = buildFeatureV2;

export interface FeatureV2MissingnessReport {
  name: string;
  group: FeatureV2Group;
  missingRate: number;
  zeroRate: number;
  uniqueCount: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export function buildFeatureV2MissingnessReport(
  sets: readonly FeatureV2Set[],
): FeatureV2MissingnessReport[] {
  return FEATURE_DICTIONARY_V2.map((definition) => {
    const values = sets
      .map((set) => set.features.find((feature) => feature.name === definition.name))
      .filter((feature): feature is FeatureV2Value => Boolean(feature));
    const computed = values.filter((feature) => feature.state === "COMPUTED");
    const numericValues = computed
      .map((feature) => feature.value)
      .filter((value): value is number => typeof value === "number");
    return {
      name: definition.name,
      group: definition.group,
      missingRate: values.length === 0 ? 1 : (values.length - computed.length) / values.length,
      zeroRate: numericValues.length === 0 ? 0 : numericValues.filter((value) => value === 0).length / numericValues.length,
      uniqueCount: new Set(computed.map((feature) => JSON.stringify(feature.value))).size,
      mean: average(numericValues),
      min: numericValues.length ? Math.min(...numericValues) : null,
      max: numericValues.length ? Math.max(...numericValues) : null,
    };
  });
}

export function validateFeatureDictionaryV2(
  dictionary: readonly FeatureV2Definition[] = FEATURE_DICTIONARY_V2,
): string[] {
  const issues: string[] = [];
  const names = new Set<string>();
  for (const feature of dictionary) {
    if (!/^(biz|fin|crd|ops|own|ext|imp)_[a-z0-9_]+$/.test(feature.name)) {
      issues.push(`invalid feature name: ${feature.name}`);
    }
    if (names.has(feature.name)) issues.push(`duplicate feature name: ${feature.name}`);
    names.add(feature.name);
    if (feature.version !== FEATURE_SCHEMA_V2_VERSION) issues.push(`invalid feature version: ${feature.name}`);
    if (feature.modelCandidate !== false) issues.push(`modelCandidate must remain false: ${feature.name}`);
    if (feature.missingPolicy !== "null_safe") issues.push(`invalid missing policy: ${feature.name}`);
  }
  if (dictionary.length < 60 || dictionary.length > 120) {
    issues.push(`feature count must stay within 60..120: ${dictionary.length}`);
  }
  return issues;
}

function exact(measure: NumericMeasure | null | undefined): number | null {
  return measure?.kind === "EXACT" ? measure.value : null;
}

function durationDays(value: DurationValue | null): number | null {
  const amount = value ? exact(value.duration) : null;
  if (amount === null || !value) return null;
  return value.unit === "WEEK" ? amount * 7 : amount * 30;
}

function canonicalValue(
  records: readonly CanonicalInformationRecord[],
  infoCode: string,
): CanonicalInformationValue | null {
  const record = records.find((candidate) => candidate.infoCode === infoCode);
  if (!record) return null;
  const revision = selectedRevision(record);
  return revision?.valueState === "PRESENT" ? revision.value : null;
}

/**
 * Converts only directly stated canonical interview values. Exact measures are
 * retained; ranges are never collapsed to a midpoint and remain missing here.
 */
export function rawFeatureV2FromInterview(
  records: readonly CanonicalInformationRecord[],
): Record<string, FeatureV2Primitive> {
  const raw: Record<string, FeatureV2Primitive> = {};
  const sales = canonicalValue(records, "monthly_average_sales");
  const costs = canonicalValue(records, "fixed_operating_costs");
  if (sales?.kind === "PERIODIC_MONEY") raw.fin_sales_avg_3m = exact(sales.amount);
  if (sales?.kind === "PERIODIC_MONEY" && costs?.kind === "PERIODIC_MONEY") {
    const saleAmount = exact(sales.amount);
    const costAmount = exact(costs.amount);
    if (saleAmount !== null && costAmount !== null && saleAmount > 0) raw.fin_fixed_cost_ratio = costAmount / saleAmount;
  }
  const repeat = canonicalValue(records, "repeat_customer_share");
  if (repeat?.kind === "PERCENTAGE") {
    const percentage = exact(repeat.percentage);
    if (percentage !== null) raw.ops_repeat_customer_ratio = percentage / 100;
  }
  const plan = canonicalValue(records, "improvement_plan");
  if (plan?.kind === "IMPROVEMENT_PLAN") {
    raw.own_goal_target_value = exact(plan.target?.value);
    raw.own_goal_target_unit = plan.target?.unit ?? null;
    raw.own_goal_horizon_days = durationDays(plan.schedule);
    raw.own_plan_horizon_days = durationDays(plan.schedule);
    raw.own_goal_self_selected_flag = plan.owner === "BORROWER";
    raw.own_plan_measurement_metric = plan.measurementSources[0] ?? null;
  }
  const readiness = canonicalValue(records, "execution_readiness");
  if (readiness?.kind === "EXECUTION_READINESS") {
    raw.own_plan_constraint_count = readiness.blockers.length;
    raw.own_plan_budget = exact(readiness.budget?.amount);
    raw.own_plan_horizon_days ??= durationDays(readiness.schedule);
  }
  return raw;
}

export function buildInterviewFeatureV2(
  records: readonly CanonicalInformationRecord[],
  options: { enabled?: boolean; additionalRaw?: Readonly<Record<string, unknown>> } = {},
): FeatureV2Set {
  return buildFeatureV2(
    { raw: { ...rawFeatureV2FromInterview(records), ...(options.additionalRaw ?? {}) } },
    { enabled: options.enabled },
  );
}

export function isFeatureV2Enabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.ENABLE_FEATURE_V2 !== "false";
}

const dictionaryIssues = validateFeatureDictionaryV2();
if (dictionaryIssues.length > 0) {
  throw new Error(`Invalid feature_schema_v2: ${dictionaryIssues.join("; ")}`);
}
