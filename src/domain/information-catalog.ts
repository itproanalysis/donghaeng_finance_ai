import type {
  InformationCategory,
  RequiredInformationItem,
} from "./interview";
import type { CanonicalInformationValue } from "./information-values";

export const DEV_V1_CATALOG_VERSION = "dev-v1" as const;

export const DEV_V1_INFO_CODES = [
  "monthly_average_sales",
  "fixed_operating_costs",
  "improvement_plan",
  "execution_readiness",
  "confirmed_reservations",
  "seasonality_outlook",
  "essential_household_expenses",
  "emergency_buffer_months",
] as const;

export type DevV1InfoCode = (typeof DEV_V1_INFO_CODES)[number];

export const DEV_V1_OPTIONAL_INFO_CODES = [
  "platform_fee_pressure",
  "hall_customer_decline",
  "repeat_customer_share",
] as const;

export type DevV1OptionalInfoCode = (typeof DEV_V1_OPTIONAL_INFO_CODES)[number];
export type DevV1AllInfoCode = DevV1InfoCode | DevV1OptionalInfoCode;

export const DEV_V1_ALL_INFO_CODES = [
  ...DEV_V1_INFO_CODES,
  ...DEV_V1_OPTIONAL_INFO_CODES,
] as const;

export interface DevV1InformationDefinition extends RequiredInformationItem {
  infoCode: DevV1AllInfoCode;
  catalogVersion: typeof DEV_V1_CATALOG_VERSION;
  canonicalKind: CanonicalInformationValue["kind"];
  zeroMeaning: "OBSERVED_ZERO" | "REQUIRES_CONFIRMATION";
  semanticAnchors: string[];
  requiredFeatureCodes: string[];
}

export const DEV_V1_INFORMATION_CATALOG: readonly DevV1InformationDefinition[] = [
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "monthly_average_sales",
    label: "월평균 매출",
    category: "CURRENT_STATE",
    priority: "P0",
    expectedType: "AMOUNT",
    required: true,
    minQuality: "MEDIUM",
    evidencePreference: ["TRANSACTION_SUPPORTED", "SELF_REPORTED"],
    dependencies: [],
    status: "ASKING",
    canonicalKind: "PERIODIC_MONEY",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["월평균 매출", "월 매출", "매출"],
    requiredFeatureCodes: ["monthly_average_sales"],
    question:
      "먼저 최근 매출 흐름부터 편하게 말씀해 주세요. 최근 3개월 기준 이용 중인 판매 채널을 모두 합친 월평균 매출은 어느 정도인가요?",
    followupQuestion:
      "최근 3개월 기준 월평균 총매출을 한 금액 또는 실제 범위로 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "fixed_operating_costs",
    label: "월 고정 운영비",
    category: "CURRENT_STATE",
    priority: "P1",
    expectedType: "AMOUNT",
    required: true,
    minQuality: "MEDIUM",
    evidencePreference: ["DOCUMENT_SUPPORTED", "SELF_REPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "PERIODIC_MONEY",
    zeroMeaning: "REQUIRES_CONFIRMATION",
    semanticAnchors: ["고정 운영비", "고정비", "운영비"],
    requiredFeatureCodes: ["fixed_cost_ratio"],
    question: "최근 3개월 기준으로 임차료·인건비·정기구독료처럼 매달 반복되는 운영비는 평균 얼마인가요?",
    followupQuestion: "정확한 합계가 어렵다면, 월 고정 운영비가 대략 어느 범위인지 한 번만 더 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "improvement_plan",
    label: "사업 개선 계획",
    category: "IMPROVEMENT_INTENT",
    priority: "P0",
    expectedType: "TEXT",
    required: true,
    minQuality: "MEDIUM",
    evidencePreference: ["SELF_REPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "IMPROVEMENT_PLAN",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["개선 계획", "개선", "계획", "문제"],
    requiredFeatureCodes: ["self_plan_exists", "plan_specificity"],
    question: "지금 사업에서 가장 먼저 바꾸고 싶은 한 가지는 무엇인가요? 가능하면 어떻게 바꿔볼지도 함께 말씀해 주세요.",
    followupQuestion: "그 변화를 위해 할 행동과, 잘되고 있는지 확인할 수치 또는 기간을 한 번만 더 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "execution_readiness",
    label: "실행 준비도",
    category: "IMPROVEMENT_INTENT",
    priority: "P1",
    expectedType: "TEXT",
    required: true,
    minQuality: "LOW",
    evidencePreference: ["SELF_REPORTED", "DOCUMENT_SUPPORTED"],
    dependencies: ["improvement_plan"],
    status: "NEEDED",
    canonicalKind: "EXECUTION_READINESS",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["실행 준비", "준비", "인력", "예산", "일정"],
    requiredFeatureCodes: ["execution_readiness"],
    question: "그 계획을 시작하려면 지금 준비된 것과 아직 막혀 있는 것은 무엇인가요?",
    followupQuestion: "인력·예산·일정 중 준비된 것 하나와 아직 필요한 것 하나를 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "confirmed_reservations",
    label: "확정 예약 건수",
    category: "FUTURE_OUTLOOK",
    priority: "P0",
    expectedType: "INTEGER",
    required: true,
    minQuality: "MEDIUM",
    evidencePreference: ["TRANSACTION_SUPPORTED", "SELF_REPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "CONFIRMED_RESERVATIONS",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["확정 예약", "예약", "확정 주문", "수주"],
    requiredFeatureCodes: ["confirmed_reservation_count_4w"],
    question: "앞으로 4주 안에 이미 확정된 예약·주문·수주가 있다면 몇 건인가요? 없다면 0건이라고 말씀해 주세요.",
    followupQuestion: "앞으로 4주 안의 확정 건수를 한 번만 더 확인해 주세요. 알면 총액이나 예정일도 함께 말씀해 주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "seasonality_outlook",
    label: "계절성 전망",
    category: "FUTURE_OUTLOOK",
    priority: "P1",
    expectedType: "TEXT",
    required: true,
    minQuality: "LOW",
    evidencePreference: ["SELF_REPORTED", "TRANSACTION_SUPPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "SEASONALITY_OUTLOOK",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["계절성", "향후 석 달", "수요 전망", "전망"],
    requiredFeatureCodes: ["demand_visibility"],
    question: "앞으로 3개월은 평소보다 손님이나 주문이 늘 것 같나요, 비슷할 것 같나요, 줄 것 같나요? 그렇게 생각한 이유도 알려주세요.",
    followupQuestion: "그렇게 예상한 근거가 과거 매출·예약·계약·지역행사 중 무엇인지 한 번만 더 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "essential_household_expenses",
    label: "월 필수 가계지출",
    category: "HOUSEHOLD_STATE",
    priority: "P0",
    expectedType: "AMOUNT",
    required: true,
    minQuality: "MEDIUM",
    evidencePreference: ["SELF_REPORTED", "DOCUMENT_SUPPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "PERIODIC_MONEY",
    zeroMeaning: "REQUIRES_CONFIRMATION",
    semanticAnchors: ["필수 가계지출", "생활비", "가계지출"],
    requiredFeatureCodes: ["essential_living_expense"],
    question: "마지막으로 사업과 생활이 연결되는 부분을 확인할게요. 주거비·교육비 등 꼭 필요한 가계지출은 한 달에 대략 얼마인가요?",
    followupQuestion: "정확한 금액이 어렵다면, 월 필수 가계지출이 어느 범위인지 한 번만 더 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "emergency_buffer_months",
    label: "가계 비상자금 보유기간",
    category: "HOUSEHOLD_STATE",
    priority: "P1",
    expectedType: "DURATION",
    required: true,
    minQuality: "LOW",
    evidencePreference: ["SELF_REPORTED", "DOCUMENT_SUPPORTED"],
    dependencies: ["essential_household_expenses"],
    status: "NEEDED",
    canonicalKind: "DURATION",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["비상자금", "비상금", "생활비를", "감당"],
    requiredFeatureCodes: ["buffer_months"],
    question: "현재 마련해 둔 비상자금으로 필수 생활비를 대략 몇 개월 감당할 수 있나요?",
    followupQuestion: "정확히 모르시면 1개월 미만·1~3개월·3개월 이상 중 가까운 범위를 알려주세요.",
  },
] as const;

/**
 * Optional alternative-data descriptors used by the restaurant acceptance
 * journey. They augment, but never replace, the eight dev-v1 completion items.
 */
export const DEV_V1_OPTIONAL_INFORMATION_CATALOG: readonly DevV1InformationDefinition[] = [
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "platform_fee_pressure",
    label: "플랫폼 비용부담",
    category: "CURRENT_STATE",
    priority: "P0",
    expectedType: "BOOLEAN",
    required: false,
    minQuality: "LOW",
    evidencePreference: ["SELF_REPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "BUSINESS_SIGNAL",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["플랫폼 수수료", "배달 수수료", "수수료"],
    requiredFeatureCodes: [],
    question:
      "배달이나 온라인 플랫폼을 이용하고 계신다면, 최근 수수료나 광고비가 운영에 부담된 부분이 있었나요? 이용하지 않으시면 그렇지 않다고 말씀해 주세요.",
    followupQuestion: "플랫폼 수수료나 광고비가 부담된 방식이 있다면 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "hall_customer_decline",
    label: "홀매출 감소",
    category: "CURRENT_STATE",
    priority: "P0",
    expectedType: "BOOLEAN",
    required: false,
    minQuality: "LOW",
    evidencePreference: ["SELF_REPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "BUSINESS_SIGNAL",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["홀 손님", "홀손님", "홀 매출", "매장 손님"],
    requiredFeatureCodes: ["shock_present"],
    question: "최근 홀 손님이나 홀 매출에 변화가 있었나요?",
    followupQuestion: "최근 홀 손님 또는 홀 매출이 늘었는지 줄었는지 알려주세요.",
  },
  {
    catalogVersion: DEV_V1_CATALOG_VERSION,
    infoCode: "repeat_customer_share",
    label: "반복고객 비중",
    category: "CURRENT_STATE",
    priority: "P0",
    expectedType: "RATIO",
    required: false,
    minQuality: "MEDIUM",
    evidencePreference: ["SELF_REPORTED", "TRANSACTION_SUPPORTED"],
    dependencies: [],
    status: "NEEDED",
    canonicalKind: "PERCENTAGE",
    zeroMeaning: "OBSERVED_ZERO",
    semanticAnchors: ["반복고객", "단골"],
    requiredFeatureCodes: ["repeat_customer_share"],
    question: "최근 한 달 기준으로 단골 매출은 몇 % 정도인가요?",
    followupQuestion: "최근 한 달 기준으로 단골 매출은 몇 % 정도인가요?",
  },
] as const;

export const DEV_V1_ALL_INFORMATION_CATALOG: readonly DevV1InformationDefinition[] = [
  ...DEV_V1_INFORMATION_CATALOG,
  ...DEV_V1_OPTIONAL_INFORMATION_CATALOG,
] as const;

export interface CatalogValidationIssue {
  path: string;
  code: string;
  message: string;
}

const CATEGORIES = new Set<InformationCategory>([
  "CURRENT_STATE",
  "IMPROVEMENT_INTENT",
  "FUTURE_OUTLOOK",
  "HOUSEHOLD_STATE",
]);

export function validateRequiredInformationCatalog(
  items: readonly RequiredInformationItem[],
  options: { requireDevV1Codes?: boolean } = {},
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  if (items.length === 0) {
    issues.push({
      path: "items",
      code: "EMPTY_REQUIRED_INFORMATION",
      message: "필요정보 목록 없이 인터뷰를 시작할 수 없습니다.",
    });
    return issues;
  }

  const codes = new Set<string>();
  for (const [index, item] of items.entries()) {
    const path = `items[${index}]`;
    if (!item.infoCode.trim()) {
      issues.push({ path: `${path}.infoCode`, code: "EMPTY_INFO_CODE", message: "infoCode는 필수입니다." });
    } else if (codes.has(item.infoCode)) {
      issues.push({ path: `${path}.infoCode`, code: "DUPLICATE_INFO_CODE", message: `중복 infoCode입니다: ${item.infoCode}` });
    }
    codes.add(item.infoCode);
    if (!CATEGORIES.has(item.category)) {
      issues.push({ path: `${path}.category`, code: "INVALID_CATEGORY", message: "primary category는 4대 축 중 하나여야 합니다." });
    }
    if (!item.question.trim()) {
      issues.push({ path: `${path}.question`, code: "EMPTY_QUESTION", message: "질문 문구는 필수입니다." });
    }
  }

  for (const [index, item] of items.entries()) {
    for (const dependency of item.dependencies) {
      if (!codes.has(dependency)) {
        issues.push({
          path: `items[${index}].dependencies`,
          code: "UNKNOWN_DEPENDENCY",
          message: `존재하지 않는 의존성입니다: ${dependency}`,
        });
      }
      if (dependency === item.infoCode) {
        issues.push({
          path: `items[${index}].dependencies`,
          code: "SELF_DEPENDENCY",
          message: "항목은 자기 자신에 의존할 수 없습니다.",
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byCode = new Map(items.map((item) => [item.infoCode, item]));
  const visit = (code: string): boolean => {
    if (visiting.has(code)) return true;
    if (visited.has(code)) return false;
    visiting.add(code);
    const cyclic = (byCode.get(code)?.dependencies ?? []).some((dependency) => visit(dependency));
    visiting.delete(code);
    visited.add(code);
    return cyclic;
  };
  for (const code of codes) {
    if (visit(code)) {
      issues.push({ path: "items", code: "DEPENDENCY_CYCLE", message: "필요정보 의존성에 순환이 있습니다." });
      break;
    }
  }

  if (options.requireDevV1Codes) {
    const expected = new Set<string>(DEV_V1_INFO_CODES);
    const allowed = new Set<string>(DEV_V1_ALL_INFO_CODES);
    if (
      [...expected].some((code) => !codes.has(code)) ||
      [...codes].some((code) => !allowed.has(code))
    ) {
      issues.push({
        path: "items",
        code: "DEV_V1_CATALOG_MISMATCH",
        message: "dev-v1 인터뷰는 versioned 8개 핵심 infoCode를 포함하고 등록된 보조 infoCode만 사용할 수 있습니다.",
      });
    }
  }
  return issues;
}

export function createDevV1RequiredInformationItems(): RequiredInformationItem[] {
  return DEV_V1_INFORMATION_CATALOG.map((item) => ({
    infoCode: item.infoCode,
    label: item.label,
    category: item.category,
    priority: item.priority,
    expectedType: item.expectedType,
    required: item.required,
    minQuality: item.minQuality,
    evidencePreference: [...item.evidencePreference],
    dependencies: [...item.dependencies],
    status: item.status,
    question: item.question,
    followupQuestion: item.followupQuestion,
  }));
}

export function createDevV1AcceptanceRequiredInformationItems(): RequiredInformationItem[] {
  return DEV_V1_ALL_INFORMATION_CATALOG.map((item) => ({
    infoCode: item.infoCode,
    label: item.label,
    category: item.category,
    priority:
      (DEV_V1_OPTIONAL_INFO_CODES as readonly string[]).includes(item.infoCode)
        ? "P2"
        : item.priority,
    expectedType: item.expectedType,
    required: item.required,
    minQuality: item.minQuality,
    evidencePreference: [...item.evidencePreference],
    dependencies: [...item.dependencies],
    status:
      item.infoCode === "monthly_average_sales"
        ? "ASKING"
        : item.status === "ASKING"
          ? "NEEDED"
          : item.status,
    question: item.question,
    followupQuestion: item.followupQuestion,
  }));
}

export const DEV_V1_REQUIRED_INFORMATION_JSON_SCHEMA = {
  $id: "https://donghaeng.local/schemas/required-information.dev-v1.json",
  type: "array",
  minItems: 8,
  maxItems: 11,
  uniqueItems: true,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      infoCode: { type: "string", enum: DEV_V1_ALL_INFO_CODES },
      label: { type: "string", minLength: 1 },
      category: {
        type: "string",
        enum: ["CURRENT_STATE", "IMPROVEMENT_INTENT", "FUTURE_OUTLOOK", "HOUSEHOLD_STATE"],
      },
      priority: { type: "string", enum: ["P0", "P1", "P2"] },
      expectedType: {
        type: "string",
        enum: ["AMOUNT", "RATIO", "INTEGER", "TEXT", "BOOLEAN", "DATE", "DURATION", "RANGE"],
      },
      required: { type: "boolean" },
      minQuality: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      evidencePreference: {
        type: "array",
        items: {
          type: "string",
          enum: ["SELF_REPORTED", "DOCUMENT_SUPPORTED", "TRANSACTION_SUPPORTED", "SYSTEM_DERIVED", "CONFLICTING", "UNKNOWN"],
        },
      },
      dependencies: { type: "array", items: { type: "string", enum: DEV_V1_ALL_INFO_CODES } },
      status: {
        type: "string",
        enum: ["NEEDED", "ASKING", "COLLECTED", "CONFIRMED", "NEEDS_FOLLOWUP", "CONFLICT", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"],
      },
      question: { type: "string", minLength: 1 },
      followupQuestion: { type: "string", minLength: 1 },
    },
    required: [
      "infoCode",
      "label",
      "category",
      "priority",
      "expectedType",
      "required",
      "minQuality",
      "evidencePreference",
      "dependencies",
      "status",
      "question",
    ],
  },
  allOf: [
    ...DEV_V1_INFO_CODES.map((infoCode) => ({
      contains: {
        type: "object",
        required: ["infoCode"],
        properties: { infoCode: { const: infoCode } },
      },
      minContains: 1,
      maxContains: 1,
    })),
    ...DEV_V1_OPTIONAL_INFO_CODES.map((infoCode) => ({
      contains: {
        type: "object",
        required: ["infoCode"],
        properties: { infoCode: { const: infoCode } },
      },
      minContains: 0,
      maxContains: 1,
    })),
  ],
} as const;
