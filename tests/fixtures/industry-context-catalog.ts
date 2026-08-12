import type {
  InterviewContextLabel,
  SohoIndustryCode,
  SohoIndustryLabel,
} from "../../src/domain";

export interface SohoIndustryCatalogFixture {
  input: string;
  expectedCode: SohoIndustryCode;
  expectedLabel: SohoIndustryLabel;
  expectedIndustryInfoCode: string;
  expectedGoalMetric: string;
}

export const SOHO_INDUSTRY_CATALOG_FIXTURES: readonly SohoIndustryCatalogFixture[] = [
  { input: "한식 음식점", expectedCode: "RESTAURANT", expectedLabel: "음식점", expectedIndustryInfoCode: "restaurant_delivery_channel_share", expectedGoalMetric: "direct_order_share" },
  { input: "커피전문점", expectedCode: "CAFE", expectedLabel: "카페", expectedIndustryInfoCode: "cafe_daypart_sales_mix", expectedGoalMetric: "orders_by_hour" },
  { input: "오프라인 소매", expectedCode: "OFFLINE_RETAIL", expectedLabel: "오프라인 소매", expectedIndustryInfoCode: "retail_inventory_turnover", expectedGoalMetric: "aged_inventory_count" },
  { input: "전자상거래", expectedCode: "ONLINE_SHOPPING", expectedLabel: "온라인 쇼핑", expectedIndustryInfoCode: "online_platform_sales_share", expectedGoalMetric: "repeat_order_count" },
  { input: "미용실", expectedCode: "BEAUTY", expectedLabel: "미용", expectedIndustryInfoCode: "beauty_repeat_booking_share", expectedGoalMetric: "repeat_booking_count" },
  { input: "교습소", expectedCode: "ACADEMY", expectedLabel: "학원", expectedIndustryInfoCode: "academy_active_enrollment_count", expectedGoalMetric: "renewal_count" },
  { input: "펜션", expectedCode: "LODGING", expectedLabel: "숙박", expectedIndustryInfoCode: "lodging_occupancy_rate", expectedGoalMetric: "booked_room_nights" },
  { input: "카센터", expectedCode: "AUTO_REPAIR", expectedLabel: "자동차 정비", expectedIndustryInfoCode: "repair_service_booking_count", expectedGoalMetric: "service_duration" },
  { input: "리모델링", expectedCode: "INTERIOR", expectedLabel: "인테리어", expectedIndustryInfoCode: "interior_order_backlog_value", expectedGoalMetric: "quote_conversion_count" },
  { input: "화물운송", expectedCode: "TRANSPORT", expectedLabel: "운송", expectedIndustryInfoCode: "transport_trip_count", expectedGoalMetric: "empty_distance" },
  { input: "도소매·제조", expectedCode: "WHOLESALE_SMALL_MANUFACTURING", expectedLabel: "도매/소규모 제조", expectedIndustryInfoCode: "manufacturing_order_backlog_value", expectedGoalMetric: "defect_rate" },
];

export interface ContextCatalogFixture {
  input: string;
  expectedLabel: InterviewContextLabel;
  expectedKind: "SEASONALITY" | "SITUATION";
}

export const CONTEXT_CATALOG_FIXTURES: readonly ContextCatalogFixture[] = [
  { input: "새학기", expectedLabel: "신학기", expectedKind: "SEASONALITY" },
  { input: "여름방학", expectedLabel: "방학", expectedKind: "SEASONALITY" },
  { input: "추석", expectedLabel: "명절", expectedKind: "SEASONALITY" },
  { input: "송년", expectedLabel: "연말", expectedKind: "SEASONALITY" },
  { input: "여름휴가", expectedLabel: "휴가철", expectedKind: "SEASONALITY" },
  { input: "피크시즌", expectedLabel: "성수기", expectedKind: "SEASONALITY" },
  { input: "로우시즌", expectedLabel: "비수기", expectedKind: "SEASONALITY" },
  { input: "장마철", expectedLabel: "장마", expectedKind: "SEASONALITY" },
  { input: "혹한", expectedLabel: "폭염/한파", expectedKind: "SEASONALITY" },
  { input: "지역축제", expectedLabel: "지역행사", expectedKind: "SEASONALITY" },
  { input: "매출급락", expectedLabel: "매출급감", expectedKind: "SITUATION" },
  { input: "회복세", expectedLabel: "매출회복", expectedKind: "SITUATION" },
  { input: "비용급등", expectedLabel: "원가급등", expectedKind: "SITUATION" },
  { input: "임시휴업", expectedLabel: "휴업", expectedKind: "SITUATION" },
  { input: "외상대금", expectedLabel: "미수금", expectedKind: "SITUATION" },
  { input: "장기재고", expectedLabel: "재고누적", expectedKind: "SITUATION" },
  { input: "배달수수료 부담", expectedLabel: "플랫폼수수료 압박", expectedKind: "SITUATION" },
  { input: "창업", expectedLabel: "신규사업", expectedKind: "SITUATION" },
  { input: "대출증가", expectedLabel: "부채증가", expectedKind: "SITUATION" },
];
