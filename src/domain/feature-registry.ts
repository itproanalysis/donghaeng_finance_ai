import type { InformationCategory } from "./interview";
import { DEV_V1_ALL_INFO_CODES } from "./information-catalog";
import { NAMED_FEATURE_CATALOG } from "./named-feature-catalog";

export const DEV_V1_FEATURE_REGISTRY_VERSION = "dev-v1" as const;

export type FeatureValueType =
  | "AMOUNT"
  | "RATIO"
  | "COUNT"
  | "DURATION"
  | "BOOLEAN"
  | "RUBRIC"
  | "STRUCTURED";

export type FeatureMissingPolicy =
  | "PROPAGATE_MISSING"
  | "EXCLUDE_FROM_AGGREGATION"
  | "NOT_APPLICABLE_ON_ZERO_DENOMINATOR";

export interface FeatureDefinition {
  name: string;
  label: string;
  domain: InformationCategory;
  type: FeatureValueType;
  range: { min: number | null; max: number | null; unit: string | null };
  normalizerId: "NONE_DEV_V1" | "BOOLEAN_01" | "RUBRIC_0_5" | "READINESS_3_LEVEL";
  sourceInfoCodes: string[];
  sourceTypes: Array<"SELF_REPORTED" | "DOCUMENT_SUPPORTED" | "TRANSACTION_SUPPORTED" | "SYSTEM_DERIVED">;
  missingPolicy: FeatureMissingPolicy;
  modelCandidate: false;
  requiredForCompletion: boolean;
  prohibitedProxyReview: {
    status: "PASSED";
    prohibitedInputs: readonly ["sentiment", "voice_confidence", "facial_expression", "family_composition"];
  };
  version: typeof DEV_V1_FEATURE_REGISTRY_VERSION;
}

const PROXY_REVIEW = {
  status: "PASSED",
  prohibitedInputs: [
    "sentiment",
    "voice_confidence",
    "facial_expression",
    "family_composition",
  ],
} as const;

function feature(
  input: Omit<FeatureDefinition, "modelCandidate" | "prohibitedProxyReview" | "version" | "sourceTypes"> & {
    sourceTypes?: FeatureDefinition["sourceTypes"];
  },
): FeatureDefinition {
  return {
    ...input,
    sourceTypes: input.sourceTypes ?? ["SELF_REPORTED", "SYSTEM_DERIVED"],
    modelCandidate: false,
    prohibitedProxyReview: PROXY_REVIEW,
    version: DEV_V1_FEATURE_REGISTRY_VERSION,
  };
}

const BASE_DEV_V1_FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  feature({ name: "monthly_average_sales", label: "월평균 매출 원천값", domain: "CURRENT_STATE", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["monthly_average_sales"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "fixed_operating_costs", label: "월 고정 운영비 원천값", domain: "CURRENT_STATE", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["fixed_operating_costs"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "business_tenure_months", label: "업력", domain: "CURRENT_STATE", type: "DURATION", range: { min: 0, max: null, unit: "MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "sales_slope_3m", label: "3개월 매출 추세", domain: "CURRENT_STATE", type: "RATIO", range: { min: null, max: null, unit: "SLOPE" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "sales_cv_6m", label: "6개월 매출 변동계수", domain: "CURRENT_STATE", type: "RATIO", range: { min: 0, max: null, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "season_adjusted_sales_delta", label: "계절조정 매출 변화", domain: "CURRENT_STATE", type: "RATIO", range: { min: null, max: null, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "fixed_cost_ratio", label: "고정비 비율", domain: "CURRENT_STATE", type: "RATIO", range: { min: 0, max: null, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["monthly_average_sales", "fixed_operating_costs"], missingPolicy: "NOT_APPLICABLE_ON_ZERO_DENOMINATOR", requiredForCompletion: true }),
  feature({ name: "cashflow_mismatch_days", label: "현금흐름 시차", domain: "CURRENT_STATE", type: "DURATION", range: { min: 0, max: null, unit: "DAY" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "repeat_customer_share", label: "반복고객 비중", domain: "CURRENT_STATE", type: "RATIO", range: { min: 0, max: 1, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["repeat_customer_share"], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "channel_hhi", label: "채널 집중도", domain: "CURRENT_STATE", type: "RATIO", range: { min: 0, max: 1, unit: "HHI" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "shock_present", label: "사업 충격 존재", domain: "CURRENT_STATE", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: ["hall_customer_decline"], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "weeks_to_recovery", label: "회복 소요주", domain: "CURRENT_STATE", type: "DURATION", range: { min: 0, max: null, unit: "WEEK" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),

  feature({ name: "problem_specificity", label: "문제 구체성", domain: "IMPROVEMENT_INTENT", type: "RUBRIC", range: { min: 0, max: 5, unit: "LEVEL" }, normalizerId: "RUBRIC_0_5", sourceInfoCodes: ["improvement_plan"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "self_plan_exists", label: "자기계획 존재", domain: "IMPROVEMENT_INTENT", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: ["improvement_plan"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "plan_action_count", label: "계획 행동 수", domain: "IMPROVEMENT_INTENT", type: "COUNT", range: { min: 0, max: null, unit: "ACTION" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["improvement_plan"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "plan_specificity", label: "계획 구체성", domain: "IMPROVEMENT_INTENT", type: "RUBRIC", range: { min: 0, max: 5, unit: "LEVEL" }, normalizerId: "RUBRIC_0_5", sourceInfoCodes: ["improvement_plan"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "plan_time_bound", label: "계획 기간 명시", domain: "IMPROVEMENT_INTENT", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: ["improvement_plan"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "plan_measurability", label: "계획 측정 가능", domain: "IMPROVEMENT_INTENT", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: ["improvement_plan"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "execution_readiness", label: "실행 준비", domain: "IMPROVEMENT_INTENT", type: "RUBRIC", range: { min: 0, max: 1, unit: "LEVEL" }, normalizerId: "READINESS_3_LEVEL", sourceInfoCodes: ["execution_readiness"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "past_execution_examples", label: "과거 실행 사례", domain: "IMPROVEMENT_INTENT", type: "COUNT", range: { min: 0, max: null, unit: "EXAMPLE" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["execution_readiness"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "obstacle_awareness", label: "장애물 인식", domain: "IMPROVEMENT_INTENT", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: ["execution_readiness"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "evidence_readiness", label: "자료 준비", domain: "IMPROVEMENT_INTENT", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: ["execution_readiness"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),

  feature({ name: "confirmed_reservation_count_4w", label: "4주 확정 예약 건수", domain: "FUTURE_OUTLOOK", type: "COUNT", range: { min: 0, max: null, unit: "CASE" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["confirmed_reservations"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "confirmed_order_value", label: "확정 주문 금액", domain: "FUTURE_OUTLOOK", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["confirmed_reservations"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "booking_coverage_weeks", label: "예약 커버리지", domain: "FUTURE_OUTLOOK", type: "DURATION", range: { min: 0, max: null, unit: "WEEK" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["confirmed_reservations"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "pipeline_value", label: "파이프라인 금액", domain: "FUTURE_OUTLOOK", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "pipeline_coverage", label: "파이프라인 커버리지", domain: "FUTURE_OUTLOOK", type: "RATIO", range: { min: 0, max: null, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "repeat_demand_share", label: "반복수요 비중", domain: "FUTURE_OUTLOOK", type: "RATIO", range: { min: 0, max: 1, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "contracted_revenue_share", label: "계약매출 비중", domain: "FUTURE_OUTLOOK", type: "RATIO", range: { min: 0, max: 1, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "season_adjusted_growth", label: "계절조정 성장", domain: "FUTURE_OUTLOOK", type: "RATIO", range: { min: null, max: null, unit: "PERCENT" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["seasonality_outlook"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: false }),
  feature({ name: "demand_visibility", label: "수요 가시성 근거", domain: "FUTURE_OUTLOOK", type: "STRUCTURED", range: { min: null, max: null, unit: null }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["confirmed_reservations", "seasonality_outlook"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "channel_diversification", label: "수요 채널 분산", domain: "FUTURE_OUTLOOK", type: "RATIO", range: { min: 0, max: 1, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),

  feature({ name: "household_nonbusiness_income", label: "비사업 가계소득", domain: "HOUSEHOLD_STATE", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "income_stability", label: "비사업소득 안정성", domain: "HOUSEHOLD_STATE", type: "RUBRIC", range: { min: 0, max: 5, unit: "LEVEL" }, normalizerId: "RUBRIC_0_5", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "essential_living_expense", label: "필수 생활비", domain: "HOUSEHOLD_STATE", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["essential_household_expenses"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "housing_fixed_expense", label: "주거 고정비", domain: "HOUSEHOLD_STATE", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "personal_debt_service", label: "개인 채무상환", domain: "HOUSEHOLD_STATE", type: "AMOUNT", range: { min: 0, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "household_disposable_surplus", label: "가계 가처분 잉여", domain: "HOUSEHOLD_STATE", type: "AMOUNT", range: { min: null, max: null, unit: "KRW/MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "buffer_months", label: "비상자금 보유개월", domain: "HOUSEHOLD_STATE", type: "DURATION", range: { min: 0, max: null, unit: "MONTH" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: ["emergency_buffer_months"], missingPolicy: "PROPAGATE_MISSING", requiredForCompletion: true }),
  feature({ name: "business_to_household_transfer_ratio", label: "사업→가계 이전 비율", domain: "HOUSEHOLD_STATE", type: "RATIO", range: { min: 0, max: null, unit: "RATIO" }, normalizerId: "NONE_DEV_V1", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
  feature({ name: "account_separation", label: "사업·가계 계좌분리", domain: "HOUSEHOLD_STATE", type: "BOOLEAN", range: { min: 0, max: 1, unit: null }, normalizerId: "BOOLEAN_01", sourceInfoCodes: [], missingPolicy: "EXCLUDE_FROM_AGGREGATION", requiredForCompletion: false }),
] as const;

const BOOLEAN_NAMED_FEATURES = new Set([
  "shock_resolved",
  "root_cause_identified",
  "measurement_method_defined",
  "resource_awareness",
  "business_household_account_separation",
]);

const COUNT_NAMED_FEATURES = new Set([
  "cash_shortage_frequency",
  "past_execution_example_count",
  "booking_count",
]);

const STRUCTURED_NAMED_FEATURES = new Set(["past_execution_result"]);
const RUBRIC_NAMED_FEATURES = new Set(["household_income_stability"]);

function registeredMissingFeatureShape(name: string): Pick<
  FeatureDefinition,
  "type" | "range" | "normalizerId"
> {
  if (BOOLEAN_NAMED_FEATURES.has(name)) {
    return {
      type: "BOOLEAN",
      range: { min: 0, max: 1, unit: null },
      normalizerId: "BOOLEAN_01",
    };
  }
  if (COUNT_NAMED_FEATURES.has(name)) {
    return {
      type: "COUNT",
      range: { min: 0, max: null, unit: "COUNT" },
      normalizerId: "NONE_DEV_V1",
    };
  }
  if (STRUCTURED_NAMED_FEATURES.has(name)) {
    return {
      type: "STRUCTURED",
      range: { min: null, max: null, unit: null },
      normalizerId: "NONE_DEV_V1",
    };
  }
  if (RUBRIC_NAMED_FEATURES.has(name)) {
    return {
      type: "RUBRIC",
      range: { min: 0, max: 5, unit: "LEVEL" },
      normalizerId: "RUBRIC_0_5",
    };
  }
  if (name.endsWith("_months")) {
    return {
      type: "DURATION",
      range: { min: 0, max: null, unit: "MONTH" },
      normalizerId: "NONE_DEV_V1",
    };
  }
  if (name.endsWith("_days")) {
    return {
      type: "DURATION",
      range: { min: 0, max: null, unit: "DAY" },
      normalizerId: "NONE_DEV_V1",
    };
  }
  return {
    type: "RATIO",
    range: { min: null, max: null, unit: "RATIO" },
    normalizerId: "NONE_DEV_V1",
  };
}

const baseFeatureNames = new Set(BASE_DEV_V1_FEATURE_REGISTRY.map((entry) => entry.name));
const NAMED_FEATURE_REGISTRY_EXTENSIONS: readonly FeatureDefinition[] =
  NAMED_FEATURE_CATALOG.filter((entry) => !baseFeatureNames.has(entry.code)).map((entry) =>
    feature({
      name: entry.code,
      label: entry.label,
      domain: entry.domain,
      ...registeredMissingFeatureShape(entry.code),
      sourceInfoCodes: [],
      missingPolicy: "EXCLUDE_FROM_AGGREGATION",
      requiredForCompletion: false,
    }),
  );

/**
 * Runtime registry contains every named feature required by the product
 * contract. Features without an available canonical source remain explicit
 * MISSING/null rows and are never coerced to zero or model-generated.
 */
export const DEV_V1_FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  ...BASE_DEV_V1_FEATURE_REGISTRY,
  ...NAMED_FEATURE_REGISTRY_EXTENSIONS,
];

export function getFeatureDefinition(name: string): FeatureDefinition | null {
  return DEV_V1_FEATURE_REGISTRY.find((definition) => definition.name === name) ?? null;
}

export function validateFeatureRegistry(
  registry: unknown = DEV_V1_FEATURE_REGISTRY,
): string[] {
  if (!Array.isArray(registry)) return ["feature registry must be an array"];

  const issues: string[] = [];
  if (registry.length === 0) issues.push("feature registry must not be empty");
  const names = new Set<string>();
  const knownInfoCodes = new Set<string>(DEV_V1_ALL_INFO_CODES);
  const validDomains = new Set<InformationCategory>([
    "CURRENT_STATE",
    "IMPROVEMENT_INTENT",
    "FUTURE_OUTLOOK",
    "HOUSEHOLD_STATE",
  ]);
  const validTypes = new Set<FeatureValueType>([
    "AMOUNT",
    "RATIO",
    "COUNT",
    "DURATION",
    "BOOLEAN",
    "RUBRIC",
    "STRUCTURED",
  ]);
  const validMissingPolicies = new Set<FeatureMissingPolicy>([
    "PROPAGATE_MISSING",
    "EXCLUDE_FROM_AGGREGATION",
    "NOT_APPLICABLE_ON_ZERO_DENOMINATOR",
  ]);
  const validSourceTypes = new Set<FeatureDefinition["sourceTypes"][number]>([
    "SELF_REPORTED",
    "DOCUMENT_SUPPORTED",
    "TRANSACTION_SUPPORTED",
    "SYSTEM_DERIVED",
  ]);
  const requiredProhibitedInputs = [
    "sentiment",
    "voice_confidence",
    "facial_expression",
    "family_composition",
  ] as const;

  const isFiniteNumberOrNull = (value: unknown): value is number | null =>
    value === null || (typeof value === "number" && Number.isFinite(value));

  registry.forEach((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      issues.push(`feature[${index}] must be an object`);
      return;
    }

    const definition = candidate as Partial<FeatureDefinition> & Record<string, unknown>;
    const name =
      typeof definition.name === "string" && definition.name.trim().length > 0
        ? definition.name
        : `<feature[${index}]>`;

    if (typeof definition.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      issues.push(`invalid feature name: ${name}`);
    } else if (names.has(definition.name)) {
      issues.push(`duplicate feature name: ${definition.name}`);
    } else {
      names.add(definition.name);
    }

    if (typeof definition.label !== "string" || definition.label.trim().length === 0) {
      issues.push(`empty feature label: ${name}`);
    }
    if (!validDomains.has(definition.domain as InformationCategory)) {
      issues.push(`invalid feature domain: ${name}`);
    }
    if (!validTypes.has(definition.type as FeatureValueType)) {
      issues.push(`invalid feature type: ${name}`);
    }
    if (!validMissingPolicies.has(definition.missingPolicy as FeatureMissingPolicy)) {
      issues.push(`invalid missing policy: ${name}`);
    }
    if (definition.version !== DEV_V1_FEATURE_REGISTRY_VERSION) {
      issues.push(`invalid registry version: ${name}`);
    }
    if (definition.modelCandidate !== false) {
      issues.push(`dev-v1 modelCandidate must be false: ${name}`);
    }
    if (typeof definition.requiredForCompletion !== "boolean") {
      issues.push(`requiredForCompletion must be boolean: ${name}`);
    }

    const range = definition.range;
    if (typeof range !== "object" || range === null || Array.isArray(range)) {
      issues.push(`invalid feature range: ${name}`);
    } else {
      const { min, max, unit } = range as FeatureDefinition["range"];
      if (!isFiniteNumberOrNull(min) || !isFiniteNumberOrNull(max)) {
        issues.push(`range bounds must be finite numbers or null: ${name}`);
      } else if (min !== null && max !== null && min > max) {
        issues.push(`range min must be <= max: ${name}`);
      }
      if (unit !== null && (typeof unit !== "string" || unit.trim().length === 0)) {
        issues.push(`range unit must be null or a non-empty string: ${name}`);
      }
    }

    const sourceInfoCodes = definition.sourceInfoCodes;
    if (!Array.isArray(sourceInfoCodes)) {
      issues.push(`sourceInfoCodes must be an array: ${name}`);
    } else {
      const seenSourceCodes = new Set<string>();
      sourceInfoCodes.forEach((sourceInfoCode, sourceIndex) => {
        if (typeof sourceInfoCode !== "string" || sourceInfoCode.trim().length === 0) {
          issues.push(`empty sourceInfoCodes[${sourceIndex}]: ${name}`);
          return;
        }
        if (seenSourceCodes.has(sourceInfoCode)) {
          issues.push(`duplicate source info code ${sourceInfoCode}: ${name}`);
        }
        seenSourceCodes.add(sourceInfoCode);
        if (!knownInfoCodes.has(sourceInfoCode)) {
          issues.push(`unknown source info code ${sourceInfoCode}: ${name}`);
        }
      });
      if (definition.requiredForCompletion === true && sourceInfoCodes.length === 0) {
        issues.push(`required feature has no source info code: ${name}`);
      }
    }

    const sourceTypes = definition.sourceTypes;
    if (!Array.isArray(sourceTypes) || sourceTypes.length === 0) {
      issues.push(`sourceTypes must be a non-empty array: ${name}`);
    } else {
      const seenSourceTypes = new Set<string>();
      sourceTypes.forEach((sourceType) => {
        if (!validSourceTypes.has(sourceType as FeatureDefinition["sourceTypes"][number])) {
          issues.push(`invalid source type ${String(sourceType)}: ${name}`);
        }
        if (seenSourceTypes.has(String(sourceType))) {
          issues.push(`duplicate source type ${String(sourceType)}: ${name}`);
        }
        seenSourceTypes.add(String(sourceType));
      });
    }

    const normalizerId = definition.normalizerId;
    const rangeDefinition = definition.range as FeatureDefinition["range"] | undefined;
    if (normalizerId === "BOOLEAN_01") {
      if (
        definition.type !== "BOOLEAN" ||
        rangeDefinition?.min !== 0 ||
        rangeDefinition.max !== 1
      ) {
        issues.push(`BOOLEAN_01 requires BOOLEAN with range 0..1: ${name}`);
      }
    } else if (normalizerId === "RUBRIC_0_5") {
      if (
        definition.type !== "RUBRIC" ||
        rangeDefinition?.min !== 0 ||
        rangeDefinition.max !== 5
      ) {
        issues.push(`RUBRIC_0_5 requires RUBRIC with range 0..5: ${name}`);
      }
    } else if (normalizerId === "READINESS_3_LEVEL") {
      if (
        definition.type !== "RUBRIC" ||
        rangeDefinition?.min !== 0 ||
        rangeDefinition.max !== 1
      ) {
        issues.push(`READINESS_3_LEVEL requires RUBRIC with range 0..1: ${name}`);
      }
    } else if (normalizerId === "NONE_DEV_V1") {
      if (definition.type === "BOOLEAN" || definition.type === "RUBRIC") {
        issues.push(`NONE_DEV_V1 is incompatible with ${definition.type}: ${name}`);
      }
    } else {
      issues.push(`unknown normalizer: ${name}`);
    }

    const proxyReview = definition.prohibitedProxyReview;
    if (typeof proxyReview !== "object" || proxyReview === null || Array.isArray(proxyReview)) {
      issues.push(`missing prohibited proxy review: ${name}`);
    } else {
      if (proxyReview.status !== "PASSED") {
        issues.push(`proxy review must be PASSED: ${name}`);
      }
      const prohibitedInputs = proxyReview.prohibitedInputs;
      if (!Array.isArray(prohibitedInputs)) {
        issues.push(`prohibited proxy inputs must be an array: ${name}`);
      } else {
        const prohibitedSet = new Set(prohibitedInputs);
        const hasExactInputs =
          prohibitedInputs.length === requiredProhibitedInputs.length &&
          requiredProhibitedInputs.every((input) => prohibitedSet.has(input));
        if (!hasExactInputs) {
          issues.push(`prohibited proxy inputs must match dev-v1 policy: ${name}`);
        }
      }
    }
  });

  return issues;
}

export class FeatureRegistryValidationError extends TypeError {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid feature registry: ${issues.join("; ")}`);
    this.name = "FeatureRegistryValidationError";
  }
}

export function assertValidFeatureRegistry(
  registry: unknown,
): asserts registry is readonly FeatureDefinition[] {
  const issues = validateFeatureRegistry(registry);
  if (issues.length > 0) throw new FeatureRegistryValidationError(issues);
}

// Fail at module startup if a future registry edit violates the runtime contract.
assertValidFeatureRegistry(DEV_V1_FEATURE_REGISTRY);
