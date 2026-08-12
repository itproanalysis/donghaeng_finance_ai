import type { CanonicalInformationRecord, GoalMetricValue } from "./information-values";
import { selectedRevision } from "./information-values";

export const DEV_V1_GOAL_POLICY_VERSION = "dev-v1" as const;

export type GoalStatus =
  | "UNRESOLVED"
  | "CANDIDATE"
  | "NEEDS_FOLLOWUP"
  | "CONFIRMED"
  | "NO_GOAL_STATED"
  | "REFUSED"
  | "UNAVAILABLE";

export type GoalNumericStatus = "DIRECT" | "AGREED" | "UNCONFIRMED" | "NOT_APPLICABLE";

export interface BehaviorEventDefinition {
  eventName: string;
  metric: string;
  aggregation: "COUNT" | "SUM" | "AVERAGE" | "RATIO";
  source: string;
  window: string | null;
}

export interface GoalSnapshot {
  policyVersion: typeof DEV_V1_GOAL_POLICY_VERSION;
  status: GoalStatus;
  numericStatus: GoalNumericStatus;
  title: string | null;
  origin: "BORROWER_STATED" | "BORROWER_CONFIRMED_SUGGESTION" | null;
  baseline: GoalMetricValue | null;
  target: GoalMetricValue | null;
  period: { value: number; unit: "MONTH" | "WEEK" } | null;
  unit: string | null;
  measurementSources: string[];
  context: string | null;
  behaviorEvent: BehaviorEventDefinition | null;
  evidenceIds: string[];
  missingFields: string[];
}

export interface GoalCatalogEntry {
  id: string;
  industry: string;
  title: string;
  rationale: string;
  behaviorEvent: BehaviorEventDefinition;
  state: "SUGGESTED";
  defaultTarget: null;
}

const INDUSTRY_METRICS: Readonly<Record<string, readonly [string, string, BehaviorEventDefinition["aggregation"], string][]>> = {
  음식점: [
    ["채널별 매출비중 기록", "channel_sales_share", "RATIO", "POS"],
    ["원재료비 기록", "ingredient_cost", "SUM", "PURCHASE_LEDGER"],
    ["폐기량 기록", "waste_quantity", "SUM", "WASTE_LOG"],
    ["반복고객 주문 기록", "repeat_order_count", "COUNT", "POS"],
    ["예약 노쇼 기록", "no_show_count", "COUNT", "RESERVATION_LOG"],
  ],
  카페: [
    ["시간대별 주문 기록", "orders_by_hour", "COUNT", "POS"],
    ["객단가 기록", "average_ticket", "AVERAGE", "POS"],
    ["원재료 폐기 기록", "waste_cost", "SUM", "WASTE_LOG"],
    ["재방문 주문 기록", "repeat_visit_count", "COUNT", "POS"],
    ["매장·배달 채널비중 기록", "channel_sales_share", "RATIO", "POS"],
  ],
  소매: [
    ["재고회전 기록", "inventory_turnover", "RATIO", "INVENTORY_LEDGER"],
    ["장기재고 수량 기록", "aged_inventory_count", "COUNT", "INVENTORY_LEDGER"],
    ["공급처별 구매비중 기록", "supplier_purchase_share", "RATIO", "PURCHASE_LEDGER"],
    ["품목별 매출 기록", "sales_by_sku", "SUM", "POS"],
    ["반품 수량 기록", "return_count", "COUNT", "RETURN_LOG"],
  ],
  온라인: [
    ["광고비 기록", "ad_spend", "SUM", "AD_PLATFORM"],
    ["재구매 주문 기록", "repeat_order_count", "COUNT", "COMMERCE_PLATFORM"],
    ["반품률 기록", "return_rate", "RATIO", "COMMERCE_PLATFORM"],
    ["플랫폼별 매출 기록", "sales_by_platform", "SUM", "COMMERCE_PLATFORM"],
    ["전환 주문 기록", "converted_order_count", "COUNT", "COMMERCE_PLATFORM"],
  ],
  미용: [
    ["재방문 예약 기록", "repeat_booking_count", "COUNT", "RESERVATION_LOG"],
    ["노쇼 기록", "no_show_count", "COUNT", "RESERVATION_LOG"],
    ["서비스별 객단가 기록", "average_ticket_by_service", "AVERAGE", "POS"],
    ["시간대별 가동률 기록", "utilization_by_hour", "RATIO", "RESERVATION_LOG"],
    ["선결제 잔액 기록", "prepaid_balance", "SUM", "PAYMENT_LEDGER"],
  ],
  학원: [
    ["신규등록 기록", "new_enrollment_count", "COUNT", "ENROLLMENT_LOG"],
    ["재등록 기록", "renewal_count", "COUNT", "ENROLLMENT_LOG"],
    ["수강료 미수 기록", "overdue_tuition", "SUM", "ACCOUNTING_LEDGER"],
    ["강좌별 충원율 기록", "class_fill_rate", "RATIO", "ENROLLMENT_LOG"],
    ["상담 전환 기록", "consultation_conversion_count", "COUNT", "CRM"],
  ],
  숙박: [
    ["예약 객실박 기록", "booked_room_nights", "SUM", "RESERVATION_LOG"],
    ["객실 가동률 기록", "occupancy_rate", "RATIO", "RESERVATION_LOG"],
    ["평균 객실단가 기록", "average_daily_rate", "AVERAGE", "PMS"],
    ["취소 건수 기록", "cancellation_count", "COUNT", "RESERVATION_LOG"],
    ["채널별 예약비중 기록", "booking_share_by_channel", "RATIO", "PMS"],
  ],
  정비: [
    ["정비 예약 기록", "service_booking_count", "COUNT", "RESERVATION_LOG"],
    ["작업별 소요시간 기록", "service_duration", "AVERAGE", "WORK_ORDER"],
    ["부품 원가 기록", "parts_cost", "SUM", "WORK_ORDER"],
    ["재방문 정비 기록", "repeat_service_count", "COUNT", "CRM"],
    ["미수 작업대금 기록", "overdue_service_receivable", "SUM", "ACCOUNTING_LEDGER"],
  ],
  인테리어: [
    ["계약 수주액 기록", "contracted_value", "SUM", "CONTRACT_LOG"],
    ["견적 전환 기록", "quote_conversion_count", "COUNT", "CRM"],
    ["공정 지연일 기록", "schedule_delay_days", "SUM", "PROJECT_LOG"],
    ["자재비 기록", "material_cost", "SUM", "PROJECT_LEDGER"],
    ["미수금 기록", "overdue_receivable", "SUM", "ACCOUNTING_LEDGER"],
  ],
  운송: [
    ["운행 건수 기록", "trip_count", "COUNT", "DISPATCH_LOG"],
    ["차량별 매출 기록", "sales_by_vehicle", "SUM", "DISPATCH_LOG"],
    ["연료비 기록", "fuel_cost", "SUM", "FUEL_LOG"],
    ["공차거리 기록", "empty_distance", "SUM", "GPS_LOG"],
    ["계약 운송비중 기록", "contracted_trip_share", "RATIO", "CONTRACT_LOG"],
  ],
  "도소매·제조": [
    ["생산량 기록", "production_quantity", "SUM", "PRODUCTION_LOG"],
    ["불량률 기록", "defect_rate", "RATIO", "QUALITY_LOG"],
    ["재고회전 기록", "inventory_turnover", "RATIO", "INVENTORY_LEDGER"],
    ["수주잔고 기록", "order_backlog_value", "SUM", "ORDER_LOG"],
    ["공급처별 구매비중 기록", "supplier_purchase_share", "RATIO", "PURCHASE_LEDGER"],
  ],
};

export const DEV_V1_GOAL_CATALOG: readonly GoalCatalogEntry[] = Object.entries(
  INDUSTRY_METRICS,
).flatMap(([industry, metrics]) =>
  metrics.map(([title, metric, aggregation, source], index) => ({
    id: `dev-v1:${industry}:${index + 1}`,
    industry,
    title,
    rationale: `${industry} 업종에서 BehaviorEvent로 직접 측정할 수 있는 후보입니다. 차주 확인 전에는 목표가 아닙니다.`,
    behaviorEvent: {
      eventName: metric,
      metric,
      aggregation,
      source,
      window: null,
    },
    state: "SUGGESTED" as const,
    defaultTarget: null,
  })),
);

export interface SituationGoalCandidate {
  context: string;
  rationale: string;
  metric: string;
  priority: "PERSONAL_HISTORY_FIRST";
  state: "SUGGESTED";
  defaultTarget: null;
}

export const DEV_V1_SITUATION_GOAL_CANDIDATES: readonly SituationGoalCandidate[] = [
  ["명절", "명절 전후 개인 과거 매출과 주문을 우선 비교", "seasonal_order_count"],
  ["신학기", "개인 과거 신학기 수요를 우선 비교", "seasonal_enrollment_or_order_count"],
  ["휴가", "개인 과거 휴가철 수요를 우선 비교", "seasonal_sales"],
  ["연말", "개인 과거 연말 수요를 우선 비교", "seasonal_sales"],
  ["성수기", "개인 과거 성수기 가동률을 우선 비교", "capacity_utilization"],
  ["비수기", "개인 과거 비수기 고정비와 주문을 우선 비교", "fixed_cost_coverage"],
  ["장마", "개인 과거 장마 기간 채널별 주문을 우선 비교", "channel_order_count"],
  ["혹서", "개인 과거 혹서 기간 수요를 우선 비교", "weather_period_sales"],
  ["혹한", "개인 과거 혹한 기간 수요를 우선 비교", "weather_period_sales"],
  ["지역행사", "과거 동일 행사 또는 가장 유사한 지역행사를 우선 비교", "event_period_orders"],
  ["매출급락", "급락 전후 관측값으로 회복 과정을 측정", "recovery_sales"],
  ["비용급등", "원가·고정비 원천자료로 변화 측정", "cost_delta"],
  ["휴업", "영업 재개 후 주차별 주문을 측정", "weekly_reopening_orders"],
  ["미수", "회수된 미수 BehaviorEvent를 측정", "receivable_collection"],
  ["재고", "재고 입출고 Event로 장기재고 변화를 측정", "aged_inventory_count"],
].map(([context, rationale, metric]) => ({
  context,
  rationale,
  metric,
  priority: "PERSONAL_HISTORY_FIRST" as const,
  state: "SUGGESTED" as const,
  defaultTarget: null,
}));

function emptyGoal(status: GoalStatus, numericStatus: GoalNumericStatus): GoalSnapshot {
  return {
    policyVersion: DEV_V1_GOAL_POLICY_VERSION,
    status,
    numericStatus,
    title: null,
    origin: null,
    baseline: null,
    target: null,
    period: null,
    unit: null,
    measurementSources: [],
    context: null,
    behaviorEvent: null,
    evidenceIds: [],
    missingFields: [],
  };
}

export function extractGoalSnapshot(
  records: readonly CanonicalInformationRecord[],
): GoalSnapshot {
  const planRecord = records.find((record) => record.infoCode === "improvement_plan");
  if (!planRecord) return emptyGoal("UNRESOLVED", "UNCONFIRMED");
  if (planRecord.status === "REFUSED") return emptyGoal("REFUSED", "NOT_APPLICABLE");
  if (planRecord.status === "UNAVAILABLE") return emptyGoal("UNAVAILABLE", "NOT_APPLICABLE");
  const revision = selectedRevision(planRecord);
  if (!revision?.value || revision.value.kind !== "IMPROVEMENT_PLAN") {
    return emptyGoal("UNRESOLVED", "UNCONFIRMED");
  }
  const plan = revision.value;
  if (!plan.planExists) {
    return {
      ...emptyGoal("NO_GOAL_STATED", "NOT_APPLICABLE"),
      origin: "BORROWER_STATED",
      evidenceIds: revision.evidenceIds,
    };
  }
  const title = plan.actions[0]?.text ?? null;
  const period = plan.schedule?.duration.kind === "EXACT"
    ? { value: plan.schedule.duration.value, unit: plan.schedule.unit }
    : null;
  const unit = plan.target?.unit ?? plan.baseline?.unit ?? null;
  const missingFields = [
    ...(title ? [] : ["title"]),
    ...(plan.baseline ? [] : ["baseline"]),
    ...(plan.target ? [] : ["target"]),
    ...(period ? [] : ["period"]),
    ...(plan.measurementSources.length > 0 ? [] : ["measurementSource"]),
  ];
  const fullySpecified = missingFields.length === 0;
  const source = plan.measurementSources[0] ?? null;
  return {
    policyVersion: DEV_V1_GOAL_POLICY_VERSION,
    status: fullySpecified ? "CONFIRMED" : title ? "NEEDS_FOLLOWUP" : "CANDIDATE",
    numericStatus: plan.target && period ? "DIRECT" : "UNCONFIRMED",
    title,
    origin: "BORROWER_STATED",
    baseline: plan.baseline,
    target: plan.target,
    period,
    unit,
    measurementSources: plan.measurementSources,
    context: plan.problem,
    behaviorEvent: source
      ? {
          eventName: `goal_measurement:${source}`,
          metric: unit ?? "BORROWER_STATED_METRIC",
          aggregation: "SUM",
          source,
          window: period ? `${period.value} ${period.unit}` : null,
        }
      : null,
    evidenceIds: revision.evidenceIds,
    missingFields,
  };
}

export function confirmSuggestedGoal(input: {
  suggestion: GoalCatalogEntry;
  title: string;
  baseline: GoalMetricValue;
  target: GoalMetricValue;
  periodMonths: number;
  evidenceIds: string[];
}): GoalSnapshot {
  if (!input.title.trim() || !Number.isFinite(input.periodMonths) || input.periodMonths <= 0) {
    throw new TypeError("차주가 확인한 제목·baseline·target·기간이 모두 필요합니다.");
  }
  return {
    policyVersion: DEV_V1_GOAL_POLICY_VERSION,
    status: "CONFIRMED",
    numericStatus: "AGREED",
    title: input.title.trim(),
    origin: "BORROWER_CONFIRMED_SUGGESTION",
    baseline: input.baseline,
    target: input.target,
    period: { value: input.periodMonths, unit: "MONTH" },
    unit: input.target.unit,
    measurementSources: [input.suggestion.behaviorEvent.source],
    context: input.suggestion.rationale,
    behaviorEvent: {
      ...input.suggestion.behaviorEvent,
      window: `${input.periodMonths} MONTH`,
    },
    evidenceIds: [...new Set(input.evidenceIds)],
    missingFields: [],
  };
}
