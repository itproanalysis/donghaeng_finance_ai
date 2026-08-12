import type {
  EvidenceKind,
  InformationQuality,
  InformationStatus,
  ValueState,
} from "./interview";

export const CANONICAL_VALUE_SCHEMA_VERSION = "dev-v1" as const;

export type CanonicalValueSchemaVersion = typeof CANONICAL_VALUE_SCHEMA_VERSION;

export interface ExactNumericValue {
  kind: "EXACT";
  value: number;
}

export interface RangeNumericValue {
  kind: "RANGE";
  min: number;
  max: number;
}

export type NumericMeasure = ExactNumericValue | RangeNumericValue;

export interface ReferenceWindow {
  unit: "DAY" | "WEEK" | "MONTH";
  count: number;
  relation: "TRAILING" | "FORWARD" | "CURRENT";
  source: "QUESTION_CONTEXT" | "BORROWER_STATED" | "SYSTEM";
}

interface CanonicalValueBase {
  schemaVersion: CanonicalValueSchemaVersion;
}

export interface PeriodicMoneyValue extends CanonicalValueBase {
  kind: "PERIODIC_MONEY";
  amount: NumericMeasure;
  currency: "KRW";
  cadence: "MONTH";
  aggregation: "AVERAGE" | "TOTAL";
  basis:
    | "GROSS_SALES"
    | "FIXED_OPERATING_COST_TOTAL"
    | "ESSENTIAL_HOUSEHOLD_EXPENSE";
  referenceWindow: ReferenceWindow;
  channels?: string[];
  components?: Array<{
    code: string;
    label: string;
    amount: NumericMeasure;
  }>;
  grossNetBasis?: "GROSS" | "NET" | "UNSPECIFIED";
}

export interface GoalMetricValue {
  value: NumericMeasure;
  unit: string;
}

/**
 * Directly observed business-context signals. These are descriptors, not model
 * scores, and deliberately carry no sentiment or voice-derived attributes.
 */
export interface BusinessSignalValue extends CanonicalValueBase {
  kind: "BUSINESS_SIGNAL";
  signal: "PLATFORM_FEE_PRESSURE" | "HALL_CUSTOMER_DECLINE";
  observed: boolean;
  origin: "BORROWER_DIRECT";
}

export interface PercentageInformationValue extends CanonicalValueBase {
  kind: "PERCENTAGE";
  percentage: NumericMeasure;
  basis: "REPEAT_CUSTOMER_SALES_SHARE";
  referenceWindow: ReferenceWindow & { unit: "MONTH" };
  approximation: "EXPLICIT_NUMBER" | "SEMANTIC_RANGE";
}

export interface ImprovementPlanValue extends CanonicalValueBase {
  kind: "IMPROVEMENT_PLAN";
  planExists: boolean;
  problem: string | null;
  actions: Array<{
    text: string;
    evidenceSpan: TextEvidenceSpan;
  }>;
  owner: "BORROWER" | null;
  schedule: DurationValue | null;
  baseline: GoalMetricValue | null;
  target: GoalMetricValue | null;
  measurementSources: string[];
  origin: "BORROWER_DIRECT";
}

export type ReadinessResourceType =
  | "PEOPLE"
  | "BUDGET"
  | "SCHEDULE"
  | "DOCUMENT"
  | "EQUIPMENT"
  | "OTHER";

export interface ExecutionReadinessValue extends CanonicalValueBase {
  kind: "EXECUTION_READINESS";
  state: "READY" | "PARTIAL" | "NOT_STARTED";
  resources: Array<{
    type: ReadinessResourceType;
    detail: string;
    evidenceSpan: TextEvidenceSpan;
  }>;
  budget: PeriodicMoneyValue | null;
  schedule: DurationValue | null;
  blockers: string[];
  pastExamples: string[];
  evidenceReady: boolean | null;
}

export interface ConfirmedReservationsValue extends CanonicalValueBase {
  kind: "CONFIRMED_RESERVATIONS";
  count: NumericMeasure;
  unit: "CASE";
  horizon: ReferenceWindow & { unit: "WEEK"; relation: "FORWARD" };
  totalOrderValue: NumericMeasure | null;
  scheduledDates: string[];
  confirmationBasis: "BORROWER_CONFIRMED" | "DOCUMENT_SUPPORTED";
}

export type SeasonalityBasisKind =
  | "HISTORICAL"
  | "RESERVATION"
  | "CONTRACT"
  | "LOCAL_EVENT"
  | "BORROWER_EXPECTATION";

export interface SeasonalityOutlookValue extends CanonicalValueBase {
  kind: "SEASONALITY_OUTLOOK";
  direction: "UP" | "FLAT" | "DOWN" | "UNKNOWN";
  horizonMonths: 3;
  expectedChangePct: NumericMeasure | null;
  bases: Array<{
    kind: SeasonalityBasisKind;
    detail: string;
    evidenceSpan: TextEvidenceSpan;
  }>;
  drivers: string[];
}

export interface DurationValue extends CanonicalValueBase {
  kind: "DURATION";
  duration: NumericMeasure;
  unit: "MONTH" | "WEEK";
  basis: "ESSENTIAL_EXPENSE_COVERAGE" | "PLAN_SCHEDULE";
  derivedFrom: {
    numeratorEvidenceId: string;
    denominatorInfoCode: string;
    formula: string;
  } | null;
}

export type CanonicalInformationValue =
  | PeriodicMoneyValue
  | BusinessSignalValue
  | PercentageInformationValue
  | ImprovementPlanValue
  | ExecutionReadinessValue
  | ConfirmedReservationsValue
  | SeasonalityOutlookValue
  | DurationValue;

export interface TextEvidenceSpan {
  start: number;
  end: number;
  text: string;
}

export function alignEvidenceSpan(
  text: string,
  span: TextEvidenceSpan,
): TextEvidenceSpan {
  if (!text) {
    return { start: 0, end: 0, text: "" };
  }
  if (span.text) {
    const index = text.indexOf(span.text);
    if (index >= 0) {
      return {
        start: index,
        end: index + span.text.length,
        text: span.text,
      };
    }
  }
  if (span.start >= 0 && span.end <= text.length && span.start <= span.end) {
    const slice = text.slice(span.start, span.end);
    return {
      start: span.start,
      end: span.end,
      text: slice,
    };
  }
  return {
    start: 0,
    end: text.length,
    text,
  };
}

export type TerminalDisposition =
  | "UNAVAILABLE"
  | "REFUSED"
  | "NOT_APPLICABLE";

export interface CanonicalExtractionCandidate {
  infoCode: string;
  valueState: ValueState;
  value: CanonicalInformationValue | null;
  parserConfidence: number;
  quality: InformationQuality | null;
  verification: EvidenceKind;
  evidenceSpan: TextEvidenceSpan;
  missingFields: string[];
  proposedStatus: InformationStatus;
  terminalDisposition: TerminalDisposition | null;
  explanation: string;
}

export interface CanonicalValueRevision {
  id: string;
  infoCode: string;
  revision: number;
  valueState: ValueState;
  value: CanonicalInformationValue | null;
  quality: InformationQuality | null;
  parserConfidence: number | null;
  verification: EvidenceKind;
  evidenceIds: string[];
  observedAt: string;
  status: "CANDIDATE" | "SELECTED" | "SUPERSEDED" | "REJECTED" | "CONFLICTING";
  supersedesRevisionId: string | null;
}

export interface CanonicalInformationRecord {
  infoCode: string;
  category: "CURRENT_STATE" | "IMPROVEMENT_INTENT" | "FUTURE_OUTLOOK" | "HOUSEHOLD_STATE";
  required: boolean;
  priority: "P0" | "P1" | "P2";
  minQuality: InformationQuality;
  status: InformationStatus;
  valueState: ValueState;
  selectedRevisionId: string | null;
  revisions: CanonicalValueRevision[];
  updatedAt: string;
}

export interface CanonicalValidationIssue {
  path: string;
  code: string;
  message: string;
}

export function exact(value: number): ExactNumericValue {
  return { kind: "EXACT", value };
}

export function range(min: number, max: number): RangeNumericValue {
  if (min > max) {
    throw new RangeError("범위의 최솟값은 최댓값보다 클 수 없습니다.");
  }
  return { kind: "RANGE", min, max };
}

export function selectedRevision(
  record: CanonicalInformationRecord,
): CanonicalValueRevision | null {
  if (!record.selectedRevisionId) return null;
  return (
    record.revisions.find((revision) => revision.id === record.selectedRevisionId) ?? null
  );
}

function validateNumericMeasure(
  measure: NumericMeasure,
  path: string,
  integerOnly: boolean,
): CanonicalValidationIssue[] {
  const values = measure.kind === "EXACT" ? [measure.value] : [measure.min, measure.max];
  const issues: CanonicalValidationIssue[] = [];
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0 || (integerOnly && !Number.isSafeInteger(value))) {
      issues.push({
        path,
        code: "INVALID_NUMERIC_MEASURE",
        message: integerOnly
          ? "값은 0 이상의 safe integer여야 합니다."
          : "값은 0 이상의 유한수여야 합니다.",
      });
    }
  }
  if (measure.kind === "RANGE" && measure.min > measure.max) {
    issues.push({
      path,
      code: "INVALID_RANGE_ORDER",
      message: "범위의 최솟값은 최댓값보다 클 수 없습니다.",
    });
  }
  return issues;
}

export function validateCanonicalInformationValue(
  value: CanonicalInformationValue,
): CanonicalValidationIssue[] {
  const issues: CanonicalValidationIssue[] = [];
  if (value.schemaVersion !== CANONICAL_VALUE_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `지원하지 않는 canonical value schema입니다: ${value.schemaVersion}`,
    });
  }

  switch (value.kind) {
    case "PERIODIC_MONEY":
      issues.push(...validateNumericMeasure(value.amount, "amount", true));
      if (!Number.isSafeInteger(value.referenceWindow.count) || value.referenceWindow.count <= 0) {
        issues.push({
          path: "referenceWindow.count",
          code: "INVALID_REFERENCE_WINDOW",
          message: "기준기간은 1 이상의 정수여야 합니다.",
        });
      }
      break;
    case "CONFIRMED_RESERVATIONS":
      issues.push(...validateNumericMeasure(value.count, "count", true));
      if (value.totalOrderValue) {
        issues.push(...validateNumericMeasure(value.totalOrderValue, "totalOrderValue", true));
      }
      break;
    case "DURATION":
      issues.push(...validateNumericMeasure(value.duration, "duration", false));
      break;
    case "BUSINESS_SIGNAL":
      break;
    case "PERCENTAGE":
      issues.push(...validateNumericMeasure(value.percentage, "percentage", false));
      for (const percentage of value.percentage.kind === "EXACT"
        ? [value.percentage.value]
        : [value.percentage.min, value.percentage.max]) {
        if (percentage > 100) {
          issues.push({
            path: "percentage",
            code: "INVALID_PERCENTAGE",
            message: "비율은 0% 이상 100% 이하여야 합니다.",
          });
        }
      }
      break;
    case "IMPROVEMENT_PLAN":
      if (!value.planExists && value.actions.length > 0) {
        issues.push({
          path: "actions",
          code: "PLAN_EXISTENCE_CONFLICT",
          message: "planExists=false인 계획에는 실행 항목이 있을 수 없습니다.",
        });
      }
      break;
    case "EXECUTION_READINESS":
      if (value.state === "NOT_STARTED" && value.resources.length > 0) {
        issues.push({
          path: "resources",
          code: "READINESS_STATE_CONFLICT",
          message: "NOT_STARTED 상태에는 준비 완료 자원을 기록할 수 없습니다.",
        });
      }
      break;
    case "SEASONALITY_OUTLOOK":
      if (value.expectedChangePct) {
        issues.push(
          ...validateNumericMeasure(value.expectedChangePct, "expectedChangePct", false),
        );
      }
      break;
  }
  return issues;
}

export function assertCanonicalInformationValue(
  value: CanonicalInformationValue,
): void {
  const issues = validateCanonicalInformationValue(value);
  if (issues.length > 0) {
    throw new TypeError(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}

/** Runtime API/DB validators may consume this schema; semantic invariants also use the validator above. */
export const CANONICAL_INFORMATION_VALUE_JSON_SCHEMA = {
  $id: "https://donghaeng.local/schemas/canonical-information-value.dev-v1.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  oneOf: [
    { $ref: "#/$defs/periodicMoney" },
    { $ref: "#/$defs/businessSignal" },
    { $ref: "#/$defs/percentageInformation" },
    { $ref: "#/$defs/improvementPlan" },
    { $ref: "#/$defs/executionReadiness" },
    { $ref: "#/$defs/confirmedReservations" },
    { $ref: "#/$defs/seasonalityOutlook" },
    { $ref: "#/$defs/duration" },
  ],
  $defs: {
    exact: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: {
        kind: { const: "EXACT" },
        value: { type: "number", minimum: 0 },
      },
    },
    range: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "min", "max"],
      properties: {
        kind: { const: "RANGE" },
        min: { type: "number", minimum: 0 },
        max: { type: "number", minimum: 0 },
      },
    },
    numeric: { oneOf: [{ $ref: "#/$defs/exact" }, { $ref: "#/$defs/range" }] },
    referenceWindow: {
      type: "object",
      additionalProperties: false,
      required: ["unit", "count", "relation", "source"],
      properties: {
        unit: { enum: ["DAY", "WEEK", "MONTH"] },
        count: { type: "integer", minimum: 1 },
        relation: { enum: ["TRAILING", "FORWARD", "CURRENT"] },
        source: { enum: ["QUESTION_CONTEXT", "BORROWER_STATED", "SYSTEM"] },
      },
    },
    periodicMoney: {
      type: "object",
      required: ["schemaVersion", "kind", "amount", "currency", "cadence", "aggregation", "basis", "referenceWindow"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "PERIODIC_MONEY" },
        amount: { $ref: "#/$defs/numeric" },
        currency: { const: "KRW" },
        cadence: { const: "MONTH" },
        aggregation: { enum: ["AVERAGE", "TOTAL"] },
        basis: { enum: ["GROSS_SALES", "FIXED_OPERATING_COST_TOTAL", "ESSENTIAL_HOUSEHOLD_EXPENSE"] },
        referenceWindow: { $ref: "#/$defs/referenceWindow" },
      },
    },
    businessSignal: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "kind", "signal", "observed", "origin"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "BUSINESS_SIGNAL" },
        signal: { enum: ["PLATFORM_FEE_PRESSURE", "HALL_CUSTOMER_DECLINE"] },
        observed: { type: "boolean" },
        origin: { const: "BORROWER_DIRECT" },
      },
    },
    percentageInformation: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "kind", "percentage", "basis", "referenceWindow", "approximation"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "PERCENTAGE" },
        percentage: { $ref: "#/$defs/numeric" },
        basis: { const: "REPEAT_CUSTOMER_SALES_SHARE" },
        referenceWindow: { $ref: "#/$defs/referenceWindow" },
        approximation: { enum: ["EXPLICIT_NUMBER", "SEMANTIC_RANGE"] },
      },
    },
    improvementPlan: {
      type: "object",
      required: ["schemaVersion", "kind", "planExists", "problem", "actions", "owner", "schedule", "baseline", "target", "measurementSources", "origin"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "IMPROVEMENT_PLAN" },
        planExists: { type: "boolean" },
        problem: { type: ["string", "null"] },
        actions: { type: "array" },
        owner: { enum: ["BORROWER", null] },
        measurementSources: { type: "array", items: { type: "string" } },
        origin: { const: "BORROWER_DIRECT" },
      },
    },
    executionReadiness: {
      type: "object",
      required: ["schemaVersion", "kind", "state", "resources", "budget", "schedule", "blockers", "pastExamples", "evidenceReady"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "EXECUTION_READINESS" },
        state: { enum: ["READY", "PARTIAL", "NOT_STARTED"] },
        resources: { type: "array" },
        blockers: { type: "array", items: { type: "string" } },
        pastExamples: { type: "array", items: { type: "string" } },
        evidenceReady: { type: ["boolean", "null"] },
      },
    },
    confirmedReservations: {
      type: "object",
      required: ["schemaVersion", "kind", "count", "unit", "horizon", "totalOrderValue", "scheduledDates", "confirmationBasis"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "CONFIRMED_RESERVATIONS" },
        count: { $ref: "#/$defs/numeric" },
        unit: { const: "CASE" },
        horizon: { $ref: "#/$defs/referenceWindow" },
        scheduledDates: { type: "array", items: { type: "string", format: "date" } },
        confirmationBasis: { enum: ["BORROWER_CONFIRMED", "DOCUMENT_SUPPORTED"] },
      },
    },
    seasonalityOutlook: {
      type: "object",
      required: ["schemaVersion", "kind", "direction", "horizonMonths", "expectedChangePct", "bases", "drivers"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "SEASONALITY_OUTLOOK" },
        direction: { enum: ["UP", "FLAT", "DOWN", "UNKNOWN"] },
        horizonMonths: { const: 3 },
        bases: { type: "array" },
        drivers: { type: "array", items: { type: "string" } },
      },
    },
    duration: {
      type: "object",
      required: ["schemaVersion", "kind", "duration", "unit", "basis", "derivedFrom"],
      properties: {
        schemaVersion: { const: "dev-v1" },
        kind: { const: "DURATION" },
        duration: { $ref: "#/$defs/numeric" },
        unit: { enum: ["MONTH", "WEEK"] },
        basis: { enum: ["ESSENTIAL_EXPENSE_COVERAGE", "PLAN_SCHEDULE"] },
      },
    },
  },
} as const;
