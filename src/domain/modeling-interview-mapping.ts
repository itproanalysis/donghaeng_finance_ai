import type { GoalSnapshot } from "./goals";
import type { DevV1AllInfoCode } from "./information-catalog";
import {
  selectedRevision,
  type CanonicalInformationRecord,
  type CanonicalInformationValue,
  type NumericMeasure,
  type OperatingDayDropReason,
} from "./information-values";

/**
 * 인터뷰 결과를 modeling 파이프라인의 interview.json 필드로 옮긴다.
 *
 * modeling/features/interview.py가 "보기 매핑은 인터뷰 쪽 몫"이라고 정한 경계가
 * 여기다. 계산은 하지 않고 이름과 단위만 바꾸며, 옮길 수 없는 값은 0이나 중간값을
 * 만들지 않고 상태 문자열로 남긴다.
 */

export const MODELING_MISSING = "MISSING" as const;
export const MODELING_REFUSED = "REFUSED" as const;
export const MODELING_NOT_APPLICABLE = "NOT_APPLICABLE" as const;
export const MODELING_UNDECIDED = "UNDECIDED" as const;

export type ModelingState =
  | typeof MODELING_MISSING
  | typeof MODELING_REFUSED
  | typeof MODELING_NOT_APPLICABLE
  | typeof MODELING_UNDECIDED;

export type ModelingAnswerValue = number | boolean | string | number[] | ModelingState;

/** 앞으로 잡혀 있는 계약 주수를 물을 수 있는 업종. 나머지는 해당 없음으로 둔다. */
const BOOKING_COVERAGE_INDUSTRIES = new Set(["INTERIOR"]);

/** 사유 보기의 modeling 표기. thresholds.py의 사유 구분과 같은 낱말을 쓴다. */
const OPERATING_DAY_DROP_REASON_LABELS: Readonly<Record<OperatingDayDropReason, string>> = {
  HEALTH: "건강",
  FAMILY: "가족",
  STAFFING: "일손",
  DEMAND_DECLINE: "수요 감소",
  BUSINESS_DOWNSIZING: "사업 축소",
};

/**
 * 목표 단위에서 대조할 피처를 정한다. thresholds.py의 DRIVER_GOAL_FEATURE가 인정하는
 * 세 피처만 대상이고, 그 밖의 단위는 대조 피처를 만들지 않는다.
 */
const GOAL_FEATURE_BY_UNIT: Readonly<Record<string, string>> = {
  DAY: "biz_operating_day_count_avg_3m",
  CASE: "ops_transaction_count_avg_3m",
  KRW: "ops_avg_ticket_3m",
};

const DAYS_PER_MONTH = 30;
const DAYS_PER_WEEK = 7;

function exactNumber(measure: NumericMeasure | null | undefined): number | null {
  if (!measure || measure.kind !== "EXACT") return null;
  return measure.value;
}

function valueOf(
  records: readonly CanonicalInformationRecord[],
  infoCode: DevV1AllInfoCode,
): { value: CanonicalInformationValue | null; status: string } | null {
  const record = records.find((item) => item.infoCode === infoCode);
  if (!record) return null;
  return { value: selectedRevision(record)?.value ?? null, status: record.status };
}

function moneyAmount(
  records: readonly CanonicalInformationRecord[],
  infoCode: DevV1AllInfoCode,
): ModelingAnswerValue {
  const found = valueOf(records, infoCode);
  if (!found) return MODELING_MISSING;
  if (found.status === "REFUSED") return MODELING_REFUSED;
  if (found.status === "NOT_APPLICABLE") return MODELING_NOT_APPLICABLE;
  if (found.value?.kind !== "PERIODIC_MONEY") return MODELING_MISSING;
  const amount = exactNumber(found.value.amount);
  return amount === null ? MODELING_MISSING : amount;
}

function goalHorizonDays(goal: GoalSnapshot): ModelingAnswerValue {
  if (!goal.period) return MODELING_UNDECIDED;
  const perUnit = goal.period.unit === "MONTH" ? DAYS_PER_MONTH : DAYS_PER_WEEK;
  return goal.period.value * perUnit;
}

function operatingDayDrop(
  records: readonly CanonicalInformationRecord[],
): { reason: ModelingAnswerValue; resolved: ModelingAnswerValue } {
  const found = valueOf(records, "operating_day_drop_reason");
  if (!found) {
    return { reason: MODELING_NOT_APPLICABLE, resolved: MODELING_NOT_APPLICABLE };
  }
  if (found.value?.kind !== "BUSINESS_SIGNAL" || found.value.signal !== "OPERATING_DAY_DROP") {
    return { reason: MODELING_MISSING, resolved: MODELING_MISSING };
  }
  const { reason, resolved } = found.value;
  return {
    reason: reason ? OPERATING_DAY_DROP_REASON_LABELS[reason] : MODELING_MISSING,
    resolved: resolved === null ? MODELING_MISSING : resolved,
  };
}

export interface ModelingInterviewMappingInput {
  industryCode: string;
  informationItems: readonly CanonicalInformationRecord[];
  goalSnapshot: GoalSnapshot;
}

/**
 * 옮기지 않는 필드와 그 이유. 문서와 검증 스크립트가 이 목록을 그대로 읽는다.
 */
export const MODELING_UNMAPPED_FIELDS: Readonly<Record<string, string>> = {
  own_peak_months: "앱이 성수기 달을 묻지 않는다",
  own_primary_problem: "앱은 자유서술로 받아 보기로 바꾸지 않는다",
  own_plan_action_category: "앱은 자유서술로 받아 보기로 바꾸지 않는다",
  own_plan_blockers: "앱은 자유서술로 받아 보기로 바꾸지 않는다",
  own_plan_top_blocker: "앱은 자유서술로 받아 보기로 바꾸지 않는다",
  own_prior_action_type: "앱이 묻지 않는다",
  own_prior_action_result: "앱이 묻지 않는다",
  own_prior_action_ongoing_flag: "앱이 묻지 않는다",
  own_fund_purpose: "앱이 묻지 않는다",
  own_fund_amount: "앱이 묻지 않는다",
  ops_platform_fee_ratio: "앱은 부담 여부만 받고 modeling은 비율을 요구해 단위가 다르다",
  own_fixed_cost_increase_reason: "이 인터뷰에서 조건에 걸리지 않은 추가 질문이다",
  own_low_balance_coping_method: "이 인터뷰에서 조건에 걸리지 않은 추가 질문이다",
  own_purchase_increase_reason: "이 인터뷰에서 조건에 걸리지 않은 추가 질문이다",
};

export function buildModelingInterviewAnswers(
  input: ModelingInterviewMappingInput,
): Record<string, ModelingAnswerValue> {
  const { industryCode, informationItems: records, goalSnapshot: goal } = input;

  const seasonality = valueOf(records, "seasonality_outlook")?.value;
  const seasonalityDirection =
    seasonality?.kind === "SEASONALITY_OUTLOOK"
      ? seasonality.direction === "UP"
        ? "성수기"
        : seasonality.direction === "DOWN"
          ? "비수기"
          : MODELING_MISSING
      : MODELING_MISSING;

  const repeat = valueOf(records, "repeat_customer_share")?.value;
  const repeatPercentage =
    repeat?.kind === "PERCENTAGE" ? exactNumber(repeat.percentage) : null;

  const hall = valueOf(records, "hall_customer_decline");
  const readiness = valueOf(records, "execution_readiness")?.value;
  const planBudget =
    readiness?.kind === "EXECUTION_READINESS" && readiness.budget
      ? (exactNumber(readiness.budget.amount) ?? MODELING_UNDECIDED)
      : MODELING_UNDECIDED;

  const bookingApplies = BOOKING_COVERAGE_INDUSTRIES.has(industryCode);
  const drop = operatingDayDrop(records);

  const goalUnit = goal.target?.unit ?? null;
  const goalTarget = exactNumber(goal.target?.value ?? null);
  const horizonDays = goalHorizonDays(goal);

  return {
    stated_monthly_sales: moneyAmount(records, "monthly_average_sales"),
    own_essential_expense: moneyAmount(records, "essential_household_expenses"),
    own_buffer_months: (() => {
      const buffer = valueOf(records, "emergency_buffer_months")?.value;
      if (buffer?.kind !== "DURATION") return MODELING_MISSING;
      return exactNumber(buffer.duration) ?? MODELING_MISSING;
    })(),
    ops_repeat_customer_ratio:
      repeatPercentage === null ? MODELING_MISSING : repeatPercentage / 100,
    own_seasonality_direction: seasonalityDirection,
    own_confirmed_order_value: bookingApplies ? MODELING_MISSING : MODELING_NOT_APPLICABLE,
    own_booking_coverage_weeks: bookingApplies ? MODELING_MISSING : MODELING_NOT_APPLICABLE,
    own_confirmed_order_deposit_flag: bookingApplies ? MODELING_MISSING : MODELING_NOT_APPLICABLE,
    biz_hall_customer_decline_flag:
      hall?.value?.kind === "BUSINESS_SIGNAL" && hall.value.signal === "HALL_CUSTOMER_DECLINE"
        ? hall.value.observed
        : MODELING_NOT_APPLICABLE,
    own_operating_day_drop_reason: drop.reason,
    own_operating_day_drop_resolved_flag: drop.resolved,
    own_goal_evidence_feature:
      goalUnit && GOAL_FEATURE_BY_UNIT[goalUnit] ? GOAL_FEATURE_BY_UNIT[goalUnit] : MODELING_MISSING,
    own_goal_target_value: goalTarget === null ? MODELING_UNDECIDED : goalTarget,
    own_goal_horizon_days: horizonDays,
    own_goal_self_selected_flag: goal.origin === "BORROWER_STATED",
    own_plan_horizon_days: horizonDays,
    own_plan_budget: planBudget,
    ...Object.fromEntries(
      Object.keys(MODELING_UNMAPPED_FIELDS).map((field) => [
        field,
        field.endsWith("_reason") || field.endsWith("_method") || field === "ops_platform_fee_ratio"
          ? MODELING_NOT_APPLICABLE
          : MODELING_MISSING,
      ]),
    ),
  };
}
