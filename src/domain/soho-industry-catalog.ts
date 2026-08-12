import { DEV_V1_INFO_CODES, type DevV1InfoCode } from "./information-catalog";
import type { InformationCategory, InformationPriority } from "./interview";

export const SOHO_INDUSTRY_CATALOG_VERSION = "dev-v1" as const;

export const REQUIRED_SOHO_INDUSTRY_LABELS = [
  "음식점",
  "카페",
  "오프라인 소매",
  "온라인 쇼핑",
  "미용",
  "학원",
  "숙박",
  "자동차 정비",
  "인테리어",
  "운송",
  "도매/소규모 제조",
] as const;

export type SohoIndustryLabel = (typeof REQUIRED_SOHO_INDUSTRY_LABELS)[number];

export type SohoIndustryCode =
  | "RESTAURANT"
  | "CAFE"
  | "OFFLINE_RETAIL"
  | "ONLINE_SHOPPING"
  | "BEAUTY"
  | "ACADEMY"
  | "LODGING"
  | "AUTO_REPAIR"
  | "INTERIOR"
  | "TRANSPORT"
  | "WHOLESALE_SMALL_MANUFACTURING";

export interface IndustryInformationCandidate {
  infoCode: string;
  label: string;
  category: InformationCategory;
  priority: InformationPriority;
  expectedType: "AMOUNT" | "RATIO" | "INTEGER" | "DURATION" | "TEXT";
  evidencePreference: readonly string[];
  question: string;
  runtimeState: "CATALOG_ONLY";
  missingValue: null;
}

export interface IndustryGoalCandidate {
  id: string;
  title: string;
  metric: string;
  aggregation: "COUNT" | "SUM" | "AVERAGE" | "RATIO";
  source: string;
  state: "SUGGESTED";
  defaultTarget: null;
  requiresBorrowerConfirmation: true;
}

export interface SohoIndustryProfile {
  catalogVersion: typeof SOHO_INDUSTRY_CATALOG_VERSION;
  code: SohoIndustryCode;
  label: SohoIndustryLabel;
  aliases: readonly string[];
  coreRequiredInformationCodes: readonly DevV1InfoCode[];
  industryInformationItems: readonly IndustryInformationCandidate[];
  goalCandidates: readonly IndustryGoalCandidate[];
  numericDefaultsAllowed: false;
}

export interface IndustryInterviewProfile {
  catalogVersion: typeof SOHO_INDUSTRY_CATALOG_VERSION;
  industryCode: SohoIndustryCode;
  industryLabel: SohoIndustryLabel;
  strictRequiredInformationCodes: DevV1InfoCode[];
  industryInformationCandidates: IndustryInformationCandidate[];
  goalCandidates: IndustryGoalCandidate[];
}

type InfoInput = readonly [
  infoCode: string,
  label: string,
  category: InformationCategory,
  priority: InformationPriority,
  expectedType: IndustryInformationCandidate["expectedType"],
  evidencePreference: readonly string[],
  question: string,
];

type GoalInput = readonly [
  title: string,
  metric: string,
  aggregation: IndustryGoalCandidate["aggregation"],
  source: string,
];

function industryProfile(input: {
  code: SohoIndustryCode;
  label: SohoIndustryLabel;
  aliases: readonly string[];
  information: readonly InfoInput[];
  goals: readonly GoalInput[];
}): SohoIndustryProfile {
  return {
    catalogVersion: SOHO_INDUSTRY_CATALOG_VERSION,
    code: input.code,
    label: input.label,
    aliases: input.aliases,
    coreRequiredInformationCodes: DEV_V1_INFO_CODES,
    industryInformationItems: input.information.map(
      ([infoCode, label, category, priority, expectedType, evidencePreference, question]) => ({
        infoCode,
        label,
        category,
        priority,
        expectedType,
        evidencePreference,
        question,
        runtimeState: "CATALOG_ONLY",
        missingValue: null,
      }),
    ),
    goalCandidates: input.goals.map(([title, metric, aggregation, source], index) => ({
      id: `${SOHO_INDUSTRY_CATALOG_VERSION}:${input.code}:${index + 1}`,
      title,
      metric,
      aggregation,
      source,
      state: "SUGGESTED",
      defaultTarget: null,
      requiresBorrowerConfirmation: true,
    })),
    numericDefaultsAllowed: false,
  };
}

export const SOHO_INDUSTRY_CATALOG: readonly SohoIndustryProfile[] = [
  industryProfile({
    code: "RESTAURANT",
    label: "음식점",
    aliases: ["외식", "한식 음식점"],
    information: [
      ["restaurant_delivery_channel_share", "배달채널 매출 비중", "CURRENT_STATE", "P0", "RATIO", ["POS", "DELIVERY_PLATFORM"], "최근 3개월 매출 중 배달채널 비중은 얼마인가요?"],
      ["restaurant_input_cost_ratio", "식재료 원가 비중", "CURRENT_STATE", "P0", "RATIO", ["PURCHASE_LEDGER", "SELF_REPORTED"], "최근 3개월 식재료 원가는 매출의 어느 정도인가요?"],
      ["restaurant_platform_fee_pressure", "플랫폼 수수료 부담", "CURRENT_STATE", "P1", "TEXT", ["DELIVERY_PLATFORM", "SELF_REPORTED"], "배달 플랫폼 수수료가 현금흐름에 어떤 영향을 주나요?"],
    ],
    goals: [
      ["직접주문 비중 기록", "direct_order_share", "RATIO", "POS"],
      ["식재료 원가 기록", "ingredient_cost", "SUM", "PURCHASE_LEDGER"],
      ["폐기량 기록", "waste_quantity", "SUM", "WASTE_LOG"],
    ],
  }),
  industryProfile({
    code: "CAFE",
    label: "카페",
    aliases: ["커피전문점"],
    information: [
      ["cafe_daypart_sales_mix", "시간대별 매출 구성", "CURRENT_STATE", "P1", "RATIO", ["POS"], "오전·점심·저녁 시간대별 매출 비중은 어떻게 되나요?"],
      ["cafe_average_ticket", "평균 객단가", "CURRENT_STATE", "P0", "AMOUNT", ["POS", "SELF_REPORTED"], "최근 3개월 평균 객단가는 얼마인가요?"],
      ["cafe_waste_rate", "원재료 폐기율", "CURRENT_STATE", "P1", "RATIO", ["WASTE_LOG", "PURCHASE_LEDGER"], "원재료 구매량 중 폐기되는 비중은 어느 정도인가요?"],
    ],
    goals: [
      ["시간대별 주문 기록", "orders_by_hour", "COUNT", "POS"],
      ["객단가 기록", "average_ticket", "AVERAGE", "POS"],
      ["재방문 주문 기록", "repeat_visit_count", "COUNT", "POS"],
    ],
  }),
  industryProfile({
    code: "OFFLINE_RETAIL",
    label: "오프라인 소매",
    aliases: ["소매", "오프라인소매"],
    information: [
      ["retail_inventory_turnover", "재고회전", "CURRENT_STATE", "P0", "RATIO", ["INVENTORY_LEDGER", "POS"], "최근 3개월 재고가 몇 번 회전했나요?"],
      ["retail_aged_inventory_share", "장기재고 비중", "CURRENT_STATE", "P0", "RATIO", ["INVENTORY_LEDGER"], "90일 이상 장기재고 비중은 얼마인가요?"],
      ["retail_supplier_concentration", "공급처 집중도", "CURRENT_STATE", "P1", "RATIO", ["PURCHASE_LEDGER"], "최대 공급처가 전체 매입에서 차지하는 비중은 얼마인가요?"],
    ],
    goals: [
      ["장기재고 수량 기록", "aged_inventory_count", "COUNT", "INVENTORY_LEDGER"],
      ["품목별 매출 기록", "sales_by_sku", "SUM", "POS"],
      ["반품 수량 기록", "return_count", "COUNT", "RETURN_LOG"],
    ],
  }),
  industryProfile({
    code: "ONLINE_SHOPPING",
    label: "온라인 쇼핑",
    aliases: ["온라인", "온라인쇼핑", "전자상거래"],
    information: [
      ["online_platform_sales_share", "플랫폼별 매출 비중", "CURRENT_STATE", "P0", "RATIO", ["COMMERCE_PLATFORM"], "플랫폼별 매출 비중은 어떻게 되나요?"],
      ["online_ad_spend_ratio", "광고비 비율", "CURRENT_STATE", "P0", "RATIO", ["AD_PLATFORM", "COMMERCE_PLATFORM"], "광고비는 매출의 어느 정도인가요?"],
      ["online_return_rate", "반품률", "CURRENT_STATE", "P1", "RATIO", ["COMMERCE_PLATFORM", "RETURN_LOG"], "최근 3개월 주문의 반품률은 얼마인가요?"],
    ],
    goals: [
      ["재구매 주문 기록", "repeat_order_count", "COUNT", "COMMERCE_PLATFORM"],
      ["광고 전환 주문 기록", "converted_order_count", "COUNT", "COMMERCE_PLATFORM"],
      ["반품률 기록", "return_rate", "RATIO", "COMMERCE_PLATFORM"],
    ],
  }),
  industryProfile({
    code: "BEAUTY",
    label: "미용",
    aliases: ["미용실", "네일", "피부관리"],
    information: [
      ["beauty_repeat_booking_share", "재방문 예약 비중", "CURRENT_STATE", "P0", "RATIO", ["RESERVATION_LOG", "POS"], "최근 3개월 예약 중 재방문 고객 비중은 얼마인가요?"],
      ["beauty_no_show_rate", "노쇼율", "CURRENT_STATE", "P0", "RATIO", ["RESERVATION_LOG"], "최근 3개월 예약 중 노쇼 비중은 얼마인가요?"],
      ["beauty_prepaid_balance", "선결제 잔액", "CURRENT_STATE", "P1", "AMOUNT", ["PAYMENT_LEDGER"], "현재 남아 있는 회원권·선결제 잔액은 얼마인가요?"],
    ],
    goals: [
      ["재방문 예약 기록", "repeat_booking_count", "COUNT", "RESERVATION_LOG"],
      ["노쇼 기록", "no_show_count", "COUNT", "RESERVATION_LOG"],
      ["시간대별 가동률 기록", "utilization_by_hour", "RATIO", "RESERVATION_LOG"],
    ],
  }),
  industryProfile({
    code: "ACADEMY",
    label: "학원",
    aliases: ["교습소", "교육서비스"],
    information: [
      ["academy_active_enrollment_count", "현재 수강생 수", "CURRENT_STATE", "P0", "INTEGER", ["ENROLLMENT_LOG"], "현재 실제 수강 중인 학생은 몇 명인가요?"],
      ["academy_renewal_rate", "재등록률", "FUTURE_OUTLOOK", "P0", "RATIO", ["ENROLLMENT_LOG"], "최근 학기 재등록률은 얼마인가요?"],
      ["academy_overdue_tuition", "미수 수강료", "CURRENT_STATE", "P1", "AMOUNT", ["ACCOUNTING_LEDGER"], "납기일이 지난 미수 수강료는 얼마인가요?"],
    ],
    goals: [
      ["재등록 기록", "renewal_count", "COUNT", "ENROLLMENT_LOG"],
      ["강좌별 충원율 기록", "class_fill_rate", "RATIO", "ENROLLMENT_LOG"],
      ["상담 전환 기록", "consultation_conversion_count", "COUNT", "CRM"],
    ],
  }),
  industryProfile({
    code: "LODGING",
    label: "숙박",
    aliases: ["호텔", "펜션", "게스트하우스"],
    information: [
      ["lodging_occupancy_rate", "객실 가동률", "CURRENT_STATE", "P0", "RATIO", ["PMS", "RESERVATION_LOG"], "최근 3개월 객실 가동률은 얼마인가요?"],
      ["lodging_average_daily_rate", "평균 객실단가", "CURRENT_STATE", "P0", "AMOUNT", ["PMS"], "최근 3개월 평균 객실단가는 얼마인가요?"],
      ["lodging_cancellation_rate", "예약 취소율", "FUTURE_OUTLOOK", "P1", "RATIO", ["RESERVATION_LOG"], "최근 3개월 예약 취소율은 얼마인가요?"],
    ],
    goals: [
      ["예약 객실박 기록", "booked_room_nights", "SUM", "RESERVATION_LOG"],
      ["객실 가동률 기록", "occupancy_rate", "RATIO", "PMS"],
      ["채널별 예약비중 기록", "booking_share_by_channel", "RATIO", "PMS"],
    ],
  }),
  industryProfile({
    code: "AUTO_REPAIR",
    label: "자동차 정비",
    aliases: ["정비", "자동차정비", "카센터"],
    information: [
      ["repair_service_booking_count", "정비 예약 건수", "FUTURE_OUTLOOK", "P0", "INTEGER", ["RESERVATION_LOG"], "앞으로 4주 확정된 정비 예약은 몇 건인가요?"],
      ["repair_parts_cost_ratio", "부품 원가 비율", "CURRENT_STATE", "P0", "RATIO", ["WORK_ORDER", "PURCHASE_LEDGER"], "최근 3개월 부품 원가는 매출의 어느 정도인가요?"],
      ["repair_receivable_days", "정비대금 회수일", "CURRENT_STATE", "P1", "DURATION", ["ACCOUNTING_LEDGER"], "외상 정비대금은 평균 며칠 뒤 회수되나요?"],
    ],
    goals: [
      ["작업별 소요시간 기록", "service_duration", "AVERAGE", "WORK_ORDER"],
      ["재방문 정비 기록", "repeat_service_count", "COUNT", "CRM"],
      ["미수 작업대금 기록", "overdue_service_receivable", "SUM", "ACCOUNTING_LEDGER"],
    ],
  }),
  industryProfile({
    code: "INTERIOR",
    label: "인테리어",
    aliases: ["실내건축", "리모델링"],
    information: [
      ["interior_order_backlog_value", "수주잔고", "FUTURE_OUTLOOK", "P0", "AMOUNT", ["CONTRACT_LOG"], "현재 계약된 미착공·진행 중 공사의 남은 수주액은 얼마인가요?"],
      ["interior_project_delay_days", "공정 지연일", "CURRENT_STATE", "P0", "DURATION", ["PROJECT_LOG"], "현재 진행 중인 공사의 누적 지연일은 며칠인가요?"],
      ["interior_overdue_receivable", "공사 미수금", "CURRENT_STATE", "P0", "AMOUNT", ["ACCOUNTING_LEDGER"], "납기일이 지난 공사 미수금은 얼마인가요?"],
    ],
    goals: [
      ["견적 전환 기록", "quote_conversion_count", "COUNT", "CRM"],
      ["공정 지연일 기록", "schedule_delay_days", "SUM", "PROJECT_LOG"],
      ["미수금 회수 기록", "receivable_collection", "SUM", "ACCOUNTING_LEDGER"],
    ],
  }),
  industryProfile({
    code: "TRANSPORT",
    label: "운송",
    aliases: ["화물운송", "용달"],
    information: [
      ["transport_trip_count", "운행 건수", "CURRENT_STATE", "P0", "INTEGER", ["DISPATCH_LOG"], "최근 4주 완료한 운행은 몇 건인가요?"],
      ["transport_empty_distance_ratio", "공차거리 비율", "CURRENT_STATE", "P0", "RATIO", ["GPS_LOG", "DISPATCH_LOG"], "전체 운행거리 중 공차거리 비중은 얼마인가요?"],
      ["transport_fuel_cost_ratio", "연료비 비율", "CURRENT_STATE", "P0", "RATIO", ["FUEL_LOG", "DISPATCH_LOG"], "연료비는 운송매출의 어느 정도인가요?"],
    ],
    goals: [
      ["공차거리 기록", "empty_distance", "SUM", "GPS_LOG"],
      ["차량별 매출 기록", "sales_by_vehicle", "SUM", "DISPATCH_LOG"],
      ["계약 운송비중 기록", "contracted_trip_share", "RATIO", "CONTRACT_LOG"],
    ],
  }),
  industryProfile({
    code: "WHOLESALE_SMALL_MANUFACTURING",
    label: "도매/소규모 제조",
    aliases: ["도소매·제조", "도매", "소규모 제조", "제조"],
    information: [
      ["manufacturing_order_backlog_value", "수주잔고", "FUTURE_OUTLOOK", "P0", "AMOUNT", ["ORDER_LOG"], "현재 납품 전 수주잔고 금액은 얼마인가요?"],
      ["manufacturing_inventory_turnover", "재고회전", "CURRENT_STATE", "P0", "RATIO", ["INVENTORY_LEDGER"], "최근 3개월 원부자재와 완제품 재고가 몇 번 회전했나요?"],
      ["manufacturing_defect_rate", "불량률", "CURRENT_STATE", "P0", "RATIO", ["QUALITY_LOG", "PRODUCTION_LOG"], "최근 3개월 생산량 중 불량 비중은 얼마인가요?"],
      ["manufacturing_supplier_concentration", "공급처 집중도", "CURRENT_STATE", "P1", "RATIO", ["PURCHASE_LEDGER"], "최대 공급처의 매입 비중은 얼마인가요?"],
    ],
    goals: [
      ["불량률 기록", "defect_rate", "RATIO", "QUALITY_LOG"],
      ["수주잔고 기록", "order_backlog_value", "SUM", "ORDER_LOG"],
      ["재고회전 기록", "inventory_turnover", "RATIO", "INVENTORY_LEDGER"],
    ],
  }),
];

function normalizeIndustry(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/[\s/·_-]+/g, "");
}

export function findSohoIndustryProfile(industry: string): SohoIndustryProfile | null {
  const normalized = normalizeIndustry(industry);
  return SOHO_INDUSTRY_CATALOG.find((profile) =>
    [profile.code, profile.label, ...profile.aliases].some(
      (candidate) => normalizeIndustry(candidate) === normalized,
    ),
  ) ?? null;
}

/**
 * Keeps the dev-v1 strict completion set separate from catalog-only industry candidates.
 * Callers may display or schedule the candidates, but must not silently promote them into
 * the strict eight-item completion gate until parsers and evidence policies are versioned.
 */
export function createIndustryInterviewProfile(
  industry: string,
): IndustryInterviewProfile | null {
  const profile = findSohoIndustryProfile(industry);
  if (!profile) return null;
  return {
    catalogVersion: profile.catalogVersion,
    industryCode: profile.code,
    industryLabel: profile.label,
    strictRequiredInformationCodes: [...profile.coreRequiredInformationCodes],
    industryInformationCandidates: profile.industryInformationItems.map((item) => ({
      ...item,
      evidencePreference: [...item.evidencePreference],
    })),
    goalCandidates: profile.goalCandidates.map((goal) => ({ ...goal })),
  };
}

export function buildIndustryRequiredInformationCodes(industry: string): string[] | null {
  const profile = findSohoIndustryProfile(industry);
  if (!profile) return null;
  return [
    ...profile.coreRequiredInformationCodes,
    ...profile.industryInformationItems.map((item) => item.infoCode),
  ];
}

export function validateSohoIndustryCatalog(
  catalog: readonly SohoIndustryProfile[] = SOHO_INDUSTRY_CATALOG,
): string[] {
  const issues: string[] = [];
  const codes = new Set<string>();
  const labels = new Set<string>();
  const informationSignatures = new Set<string>();
  const goalSignatures = new Set<string>();
  for (const profile of catalog) {
    if (profile.catalogVersion !== SOHO_INDUSTRY_CATALOG_VERSION) {
      issues.push(`invalid catalog version: ${profile.code}`);
    }
    if (codes.has(profile.code)) issues.push(`duplicate industry code: ${profile.code}`);
    if (labels.has(profile.label)) issues.push(`duplicate industry label: ${profile.label}`);
    codes.add(profile.code);
    labels.add(profile.label);
    if (profile.numericDefaultsAllowed !== false) {
      issues.push(`numeric defaults must be disabled: ${profile.code}`);
    }
    const infoCodes = profile.industryInformationItems.map((item) => item.infoCode);
    if (infoCodes.length < 3) issues.push(`at least three industry information items required: ${profile.code}`);
    if (new Set(infoCodes).size !== infoCodes.length) {
      issues.push(`duplicate industry information item: ${profile.code}`);
    }
    const informationSignature = [...infoCodes].sort().join("|");
    if (informationSignatures.has(informationSignature)) {
      issues.push(`industry information items must differ: ${profile.code}`);
    }
    informationSignatures.add(informationSignature);

    const goalMetrics = profile.goalCandidates.map((goal) => goal.metric);
    if (goalMetrics.length < 3) issues.push(`at least three goal candidates required: ${profile.code}`);
    if (new Set(goalMetrics).size !== goalMetrics.length) {
      issues.push(`duplicate goal metric: ${profile.code}`);
    }
    const goalSignature = [...goalMetrics].sort().join("|");
    if (goalSignatures.has(goalSignature)) {
      issues.push(`industry goal candidates must differ: ${profile.code}`);
    }
    goalSignatures.add(goalSignature);
    if (profile.goalCandidates.some((goal) =>
      goal.state !== "SUGGESTED" ||
      goal.defaultTarget !== null ||
      goal.requiresBorrowerConfirmation !== true
    )) {
      issues.push(`goals must remain unconfirmed suggestions without defaults: ${profile.code}`);
    }
  }
  for (const label of REQUIRED_SOHO_INDUSTRY_LABELS) {
    if (!labels.has(label)) issues.push(`missing required industry: ${label}`);
  }
  return issues;
}
