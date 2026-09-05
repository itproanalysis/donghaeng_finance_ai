import { DEV_V1_ALL_INFORMATION_CATALOG } from "./information-catalog";
import {
  selectTurnNextQuestionCandidates,
  type DeterministicTurnPlan,
  type ProposedInformationTransition,
} from "./interview-orchestrator";
import {
  INFORMATION_STATUSES,
  type EvidenceKind,
  type InformationItem,
  type InformationQuality,
  type InformationStatus,
  type NextQuestion,
  type ValueState,
} from "./interview";
import {
  assertCanonicalInformationValue,
  OPERATING_DAY_DROP_REASONS,
  type CanonicalInformationValue,
  type CanonicalExtractionCandidate,
  type TextEvidenceSpan,
} from "./information-values";
import { isInformationTransitionAllowed } from "./state-machine";

export interface OrchestratorTurnInput {
  text: string;
  currentInfoCode: string | null;
  informationItems: InformationItem[];
  /**
   * The active item already received its one permitted clarification question.
   * A second incomplete answer must be recorded as unavailable rather than
   * keeping the borrower in a repeated question loop.
   */
  followupExhaustedInfoCodes?: readonly string[];
}

export interface OrchestratorContractIssue {
  path: string;
  code: string;
  message: string;
}

export class InvalidOrchestratorOutputError extends TypeError {
  readonly code = "INVALID_ORCHESTRATOR_OUTPUT";

  constructor(readonly issues: readonly OrchestratorContractIssue[]) {
    super(
      issues.length > 0
        ? issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
        : "The orchestrator output did not satisfy its runtime contract.",
    );
    this.name = "InvalidOrchestratorOutputError";
  }
}

export interface StructuredOrchestratorProvider {
  plan: (input: OrchestratorTurnInput) => unknown;
}

type UnknownRecord = Record<string, unknown>;

const VALUE_STATES = new Set<ValueState>([
  "PRESENT",
  "MISSING",
  "UNKNOWN",
  "REFUSED",
  "NOT_APPLICABLE",
]);
const QUALITIES = new Set<InformationQuality>(["LOW", "MEDIUM", "HIGH"]);
const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "TRANSACTION_SUPPORTED",
  "SYSTEM_DERIVED",
  "CONFLICTING",
  "UNKNOWN",
]);
const INFORMATION_STATUS_SET = new Set<InformationStatus>(INFORMATION_STATUSES);
const NEXT_QUESTION_REASONS = new Set<NextQuestion["reason"]>([
  "INITIAL",
  "PRIORITY",
  "FOLLOWUP",
  "CONFLICT",
]);
const TERMINAL_DISPOSITIONS = new Set([
  "UNAVAILABLE",
  "REFUSED",
  "NOT_APPLICABLE",
] as const);

function issue(
  issues: OrchestratorContractIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: OrchestratorContractIssue[],
): UnknownRecord | null {
  if (!isRecord(value)) {
    issue(issues, path, "INVALID_TYPE", "Expected an object.");
    return null;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issue(
        issues,
        `${path}.${key}`,
        "ADDITIONAL_PROPERTY",
        `Unexpected property: ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issue(issues, `${path}.${key}`, "MISSING_FIELD", `Required property is missing: ${key}`);
    }
  }
  return value;
}

function stringValue(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
  options: { nonEmpty?: boolean } = {},
): string | null {
  if (typeof value !== "string") {
    issue(issues, path, "INVALID_TYPE", "Expected a string.");
    return null;
  }
  if (options.nonEmpty && value.trim().length === 0) {
    issue(issues, path, "EMPTY_STRING", "Expected a non-empty string.");
  }
  return value;
}

function booleanValue(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): boolean | null {
  if (typeof value !== "boolean") {
    issue(issues, path, "INVALID_TYPE", "Expected a boolean.");
    return null;
  }
  return value;
}

function finiteNumber(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
  options: { minimum?: number; maximum?: number; integer?: boolean } = {},
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(issues, path, "INVALID_NUMBER", "Expected a finite number.");
    return null;
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    issue(issues, path, "INVALID_INTEGER", "Expected a safe integer.");
  }
  if (options.minimum !== undefined && value < options.minimum) {
    issue(issues, path, "NUMBER_OUT_OF_RANGE", `Expected a value >= ${options.minimum}.`);
  }
  if (options.maximum !== undefined && value > options.maximum) {
    issue(issues, path, "NUMBER_OUT_OF_RANGE", `Expected a value <= ${options.maximum}.`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
  issues: OrchestratorContractIssue[],
): T | null {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    issue(issues, path, "INVALID_ENUM", "Value is not in the allowed enum.");
    return null;
  }
  return value as T;
}

function nullableString(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): string | null {
  if (value === null) return null;
  return stringValue(value, path, issues);
}

function stringArray(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): string[] | null {
  if (!Array.isArray(value)) {
    issue(issues, path, "INVALID_TYPE", "Expected an array of strings.");
    return null;
  }
  const result: string[] = [];
  value.forEach((entry, index) => {
    const parsed = stringValue(entry, `${path}[${index}]`, issues, { nonEmpty: true });
    if (parsed !== null) result.push(parsed);
  });
  return result;
}

function textEvidenceSpan(
  value: unknown,
  path: string,
  sourceText: string,
  issues: OrchestratorContractIssue[],
): TextEvidenceSpan | null {
  const record = strictObject(value, path, ["start", "end", "text"], [], issues);
  if (!record) return null;
  const start = finiteNumber(record.start, `${path}.start`, issues, {
    minimum: 0,
    integer: true,
  });
  const end = finiteNumber(record.end, `${path}.end`, issues, {
    minimum: 0,
    integer: true,
  });
  const text = stringValue(record.text, `${path}.text`, issues);
  if (start === null || end === null || text === null) return null;
  if (end < start || end > sourceText.length) {
    issue(
      issues,
      path,
      "INVALID_EVIDENCE_SPAN",
      "Evidence indices must satisfy 0 <= start <= end <= source text length.",
    );
  } else if (sourceText.slice(start, end) !== text) {
    issue(
      issues,
      `${path}.text`,
      "EVIDENCE_TEXT_MISMATCH",
      "Evidence text must exactly match the indexed source transcript.",
    );
  }
  return { start, end, text };
}

function numericMeasure(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  if (!isRecord(value)) {
    issue(issues, path, "INVALID_TYPE", "Expected a tagged numeric measure.");
    return;
  }
  if (value.kind === "EXACT") {
    const record = strictObject(value, path, ["kind", "value"], [], issues);
    if (record) finiteNumber(record.value, `${path}.value`, issues, { minimum: 0 });
    return;
  }
  if (value.kind === "RANGE") {
    const record = strictObject(value, path, ["kind", "min", "max"], [], issues);
    if (!record) return;
    const min = finiteNumber(record.min, `${path}.min`, issues, { minimum: 0 });
    const max = finiteNumber(record.max, `${path}.max`, issues, { minimum: 0 });
    if (min !== null && max !== null && min > max) {
      issue(issues, path, "INVALID_RANGE_ORDER", "Range minimum cannot exceed maximum.");
    }
    return;
  }
  issue(issues, `${path}.kind`, "INVALID_ENUM", "Numeric measure kind must be EXACT or RANGE.");
}

function referenceWindow(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
  constraints: { unit?: string; relation?: string } = {},
): void {
  const record = strictObject(
    value,
    path,
    ["unit", "count", "relation", "source"],
    [],
    issues,
  );
  if (!record) return;
  const units = new Set(["DAY", "WEEK", "MONTH"]);
  const relations = new Set(["TRAILING", "FORWARD", "CURRENT"]);
  const sources = new Set(["QUESTION_CONTEXT", "BORROWER_STATED", "SYSTEM"]);
  const unit = enumValue(record.unit, units, `${path}.unit`, issues);
  const relation = enumValue(record.relation, relations, `${path}.relation`, issues);
  enumValue(record.source, sources, `${path}.source`, issues);
  finiteNumber(record.count, `${path}.count`, issues, { minimum: 1, integer: true });
  if (constraints.unit && unit !== null && unit !== constraints.unit) {
    issue(issues, `${path}.unit`, "INVALID_CANONICAL_VALUE", `Expected unit ${constraints.unit}.`);
  }
  if (constraints.relation && relation !== null && relation !== constraints.relation) {
    issue(
      issues,
      `${path}.relation`,
      "INVALID_CANONICAL_VALUE",
      `Expected relation ${constraints.relation}.`,
    );
  }
}

function goalMetric(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(value, path, ["value", "unit"], [], issues);
  if (!record) return;
  numericMeasure(record.value, `${path}.value`, issues);
  stringValue(record.unit, `${path}.unit`, issues, { nonEmpty: true });
}

function periodicMoney(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    [
      "schemaVersion",
      "kind",
      "amount",
      "currency",
      "cadence",
      "aggregation",
      "basis",
      "referenceWindow",
    ],
    ["channels", "components", "grossNetBasis"],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "PERIODIC_MONEY") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected PERIODIC_MONEY.");
  }
  numericMeasure(record.amount, `${path}.amount`, issues);
  enumValue(record.currency, new Set(["KRW"]), `${path}.currency`, issues);
  enumValue(record.cadence, new Set(["MONTH"]), `${path}.cadence`, issues);
  enumValue(
    record.aggregation,
    new Set(["AVERAGE", "TOTAL"]),
    `${path}.aggregation`,
    issues,
  );
  enumValue(
    record.basis,
    new Set([
      "GROSS_SALES",
      "FIXED_OPERATING_COST_TOTAL",
      "ESSENTIAL_HOUSEHOLD_EXPENSE",
      "IMPROVEMENT_PLAN_BUDGET",
    ]),
    `${path}.basis`,
    issues,
  );
  referenceWindow(record.referenceWindow, `${path}.referenceWindow`, issues);
  if (record.channels !== undefined) stringArray(record.channels, `${path}.channels`, issues);
  if (record.components !== undefined) {
    if (!Array.isArray(record.components)) {
      issue(issues, `${path}.components`, "INVALID_TYPE", "Expected an array.");
    } else {
      record.components.forEach((component, index) => {
        const componentPath = `${path}.components[${index}]`;
        const item = strictObject(component, componentPath, ["code", "label", "amount"], [], issues);
        if (!item) return;
        stringValue(item.code, `${componentPath}.code`, issues, { nonEmpty: true });
        stringValue(item.label, `${componentPath}.label`, issues, { nonEmpty: true });
        numericMeasure(item.amount, `${componentPath}.amount`, issues);
      });
    }
  }
  if (record.grossNetBasis !== undefined) {
    enumValue(
      record.grossNetBasis,
      new Set(["GROSS", "NET", "UNSPECIFIED"]),
      `${path}.grossNetBasis`,
      issues,
    );
  }
}

function durationValue(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    ["schemaVersion", "kind", "duration", "unit", "basis", "derivedFrom"],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "DURATION") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected DURATION.");
  }
  numericMeasure(record.duration, `${path}.duration`, issues);
  enumValue(record.unit, new Set(["MONTH", "WEEK"]), `${path}.unit`, issues);
  enumValue(
    record.basis,
    new Set(["ESSENTIAL_EXPENSE_COVERAGE", "PLAN_SCHEDULE"]),
    `${path}.basis`,
    issues,
  );
  if (record.derivedFrom !== null) {
    const derived = strictObject(
      record.derivedFrom,
      `${path}.derivedFrom`,
      ["numeratorEvidenceId", "denominatorInfoCode", "formula"],
      [],
      issues,
    );
    if (derived) {
      stringValue(derived.numeratorEvidenceId, `${path}.derivedFrom.numeratorEvidenceId`, issues, {
        nonEmpty: true,
      });
      stringValue(derived.denominatorInfoCode, `${path}.derivedFrom.denominatorInfoCode`, issues, {
        nonEmpty: true,
      });
      stringValue(derived.formula, `${path}.derivedFrom.formula`, issues, { nonEmpty: true });
    }
  }
}

function businessSignal(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    ["schemaVersion", "kind", "signal", "observed", "reason", "resolved", "origin"],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "BUSINESS_SIGNAL") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected BUSINESS_SIGNAL.");
  }
  enumValue(
    record.signal,
    new Set(["PLATFORM_FEE_PRESSURE", "HALL_CUSTOMER_DECLINE", "OPERATING_DAY_DROP"]),
    `${path}.signal`,
    issues,
  );
  booleanValue(record.observed, `${path}.observed`, issues);
  if (record.reason !== null) {
    enumValue(
      record.reason,
      new Set(OPERATING_DAY_DROP_REASONS),
      `${path}.reason`,
      issues,
    );
  }
  if (record.resolved !== null) {
    booleanValue(record.resolved, `${path}.resolved`, issues);
  }
  if (record.signal !== "OPERATING_DAY_DROP" && (record.reason !== null || record.resolved !== null)) {
    issue(
      issues,
      `${path}.reason`,
      "INVALID_CANONICAL_VALUE",
      "reason과 resolved는 OPERATING_DAY_DROP에서만 값을 가질 수 있습니다.",
    );
  }
  if (record.origin !== "BORROWER_DIRECT") {
    issue(issues, `${path}.origin`, "INVALID_CANONICAL_VALUE", "Expected BORROWER_DIRECT.");
  }
}

function percentageInformation(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    ["schemaVersion", "kind", "percentage", "basis", "referenceWindow", "approximation"],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "PERCENTAGE") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected PERCENTAGE.");
  }
  numericMeasure(record.percentage, `${path}.percentage`, issues);
  if (record.basis !== "REPEAT_CUSTOMER_SALES_SHARE") {
    issue(issues, `${path}.basis`, "INVALID_CANONICAL_VALUE", "Expected repeat-customer sales basis.");
  }
  referenceWindow(record.referenceWindow, `${path}.referenceWindow`, issues, { unit: "MONTH" });
  enumValue(
    record.approximation,
    new Set(["EXPLICIT_NUMBER", "SEMANTIC_RANGE"]),
    `${path}.approximation`,
    issues,
  );
}

function improvementPlan(
  value: unknown,
  path: string,
  sourceText: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    [
      "schemaVersion",
      "kind",
      "planExists",
      "problem",
      "actions",
      "owner",
      "schedule",
      "baseline",
      "target",
      "measurementSources",
      "origin",
    ],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "IMPROVEMENT_PLAN") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected IMPROVEMENT_PLAN.");
  }
  booleanValue(record.planExists, `${path}.planExists`, issues);
  nullableString(record.problem, `${path}.problem`, issues);
  if (!Array.isArray(record.actions)) {
    issue(issues, `${path}.actions`, "INVALID_TYPE", "Expected an array.");
  } else {
    record.actions.forEach((action, index) => {
      const actionPath = `${path}.actions[${index}]`;
      const actionRecord = strictObject(action, actionPath, ["text", "evidenceSpan"], [], issues);
      if (!actionRecord) return;
      stringValue(actionRecord.text, `${actionPath}.text`, issues, { nonEmpty: true });
      textEvidenceSpan(actionRecord.evidenceSpan, `${actionPath}.evidenceSpan`, sourceText, issues);
    });
  }
  if (record.owner !== null && record.owner !== "BORROWER") {
    issue(issues, `${path}.owner`, "INVALID_ENUM", "Owner must be BORROWER or null.");
  }
  if (record.schedule !== null) durationValue(record.schedule, `${path}.schedule`, issues);
  if (record.baseline !== null) goalMetric(record.baseline, `${path}.baseline`, issues);
  if (record.target !== null) goalMetric(record.target, `${path}.target`, issues);
  stringArray(record.measurementSources, `${path}.measurementSources`, issues);
  if (record.origin !== "BORROWER_DIRECT") {
    issue(issues, `${path}.origin`, "INVALID_CANONICAL_VALUE", "Expected BORROWER_DIRECT.");
  }
}

function executionReadiness(
  value: unknown,
  path: string,
  sourceText: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    [
      "schemaVersion",
      "kind",
      "state",
      "resources",
      "budget",
      "schedule",
      "blockers",
      "pastExamples",
      "evidenceReady",
    ],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "EXECUTION_READINESS") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected EXECUTION_READINESS.");
  }
  enumValue(record.state, new Set(["READY", "PARTIAL", "NOT_STARTED"]), `${path}.state`, issues);
  if (!Array.isArray(record.resources)) {
    issue(issues, `${path}.resources`, "INVALID_TYPE", "Expected an array.");
  } else {
    record.resources.forEach((resource, index) => {
      const resourcePath = `${path}.resources[${index}]`;
      const resourceRecord = strictObject(
        resource,
        resourcePath,
        ["type", "detail", "evidenceSpan"],
        [],
        issues,
      );
      if (!resourceRecord) return;
      enumValue(
        resourceRecord.type,
        new Set(["PEOPLE", "BUDGET", "SCHEDULE", "DOCUMENT", "EQUIPMENT", "OTHER"]),
        `${resourcePath}.type`,
        issues,
      );
      stringValue(resourceRecord.detail, `${resourcePath}.detail`, issues, { nonEmpty: true });
      textEvidenceSpan(
        resourceRecord.evidenceSpan,
        `${resourcePath}.evidenceSpan`,
        sourceText,
        issues,
      );
    });
  }
  if (record.budget !== null) periodicMoney(record.budget, `${path}.budget`, issues);
  if (record.schedule !== null) durationValue(record.schedule, `${path}.schedule`, issues);
  stringArray(record.blockers, `${path}.blockers`, issues);
  stringArray(record.pastExamples, `${path}.pastExamples`, issues);
  if (record.evidenceReady !== null) {
    booleanValue(record.evidenceReady, `${path}.evidenceReady`, issues);
  }
}

function confirmedReservations(
  value: unknown,
  path: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    [
      "schemaVersion",
      "kind",
      "count",
      "unit",
      "horizon",
      "totalOrderValue",
      "scheduledDates",
      "confirmationBasis",
    ],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "CONFIRMED_RESERVATIONS") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected CONFIRMED_RESERVATIONS.");
  }
  numericMeasure(record.count, `${path}.count`, issues);
  enumValue(record.unit, new Set(["CASE"]), `${path}.unit`, issues);
  referenceWindow(record.horizon, `${path}.horizon`, issues, {
    unit: "WEEK",
    relation: "FORWARD",
  });
  if (record.totalOrderValue !== null) {
    numericMeasure(record.totalOrderValue, `${path}.totalOrderValue`, issues);
  }
  const dates = stringArray(record.scheduledDates, `${path}.scheduledDates`, issues);
  dates?.forEach((date, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      issue(
        issues,
        `${path}.scheduledDates[${index}]`,
        "INVALID_DATE",
        "Expected an ISO calendar date (YYYY-MM-DD).",
      );
    }
  });
  enumValue(
    record.confirmationBasis,
    new Set(["BORROWER_CONFIRMED", "DOCUMENT_SUPPORTED"]),
    `${path}.confirmationBasis`,
    issues,
  );
}

function seasonalityOutlook(
  value: unknown,
  path: string,
  sourceText: string,
  issues: OrchestratorContractIssue[],
): void {
  const record = strictObject(
    value,
    path,
    [
      "schemaVersion",
      "kind",
      "direction",
      "horizonMonths",
      "expectedChangePct",
      "bases",
      "drivers",
    ],
    [],
    issues,
  );
  if (!record) return;
  if (record.schemaVersion !== "dev-v1") {
    issue(issues, `${path}.schemaVersion`, "INVALID_CANONICAL_VALUE", "Expected dev-v1.");
  }
  if (record.kind !== "SEASONALITY_OUTLOOK") {
    issue(issues, `${path}.kind`, "INVALID_CANONICAL_VALUE", "Expected SEASONALITY_OUTLOOK.");
  }
  enumValue(record.direction, new Set(["UP", "FLAT", "DOWN", "UNKNOWN"]), `${path}.direction`, issues);
  const horizon = finiteNumber(record.horizonMonths, `${path}.horizonMonths`, issues, {
    integer: true,
  });
  if (horizon !== null && horizon !== 3) {
    issue(issues, `${path}.horizonMonths`, "INVALID_CANONICAL_VALUE", "Expected horizonMonths=3.");
  }
  if (record.expectedChangePct !== null) {
    numericMeasure(record.expectedChangePct, `${path}.expectedChangePct`, issues);
  }
  if (!Array.isArray(record.bases)) {
    issue(issues, `${path}.bases`, "INVALID_TYPE", "Expected an array.");
  } else {
    record.bases.forEach((basis, index) => {
      const basisPath = `${path}.bases[${index}]`;
      const basisRecord = strictObject(basis, basisPath, ["kind", "detail", "evidenceSpan"], [], issues);
      if (!basisRecord) return;
      enumValue(
        basisRecord.kind,
        new Set([
          "HISTORICAL",
          "RESERVATION",
          "CONTRACT",
          "LOCAL_EVENT",
          "BORROWER_EXPECTATION",
        ]),
        `${basisPath}.kind`,
        issues,
      );
      stringValue(basisRecord.detail, `${basisPath}.detail`, issues, { nonEmpty: true });
      textEvidenceSpan(basisRecord.evidenceSpan, `${basisPath}.evidenceSpan`, sourceText, issues);
    });
  }
  stringArray(record.drivers, `${path}.drivers`, issues);
}

function canonicalValue(
  value: unknown,
  path: string,
  sourceText: string,
  expectedKind: CanonicalInformationValue["kind"] | null,
  issues: OrchestratorContractIssue[],
): CanonicalInformationValue | null {
  if (!isRecord(value)) {
    issue(issues, path, "INVALID_TYPE", "Expected a canonical value object.");
    return null;
  }
  const startIssueCount = issues.length;
  switch (value.kind) {
    case "PERIODIC_MONEY":
      periodicMoney(value, path, issues);
      break;
    case "IMPROVEMENT_PLAN":
      improvementPlan(value, path, sourceText, issues);
      break;
    case "EXECUTION_READINESS":
      executionReadiness(value, path, sourceText, issues);
      break;
    case "CONFIRMED_RESERVATIONS":
      confirmedReservations(value, path, issues);
      break;
    case "SEASONALITY_OUTLOOK":
      seasonalityOutlook(value, path, sourceText, issues);
      break;
    case "DURATION":
      durationValue(value, path, issues);
      break;
    case "BUSINESS_SIGNAL":
      businessSignal(value, path, issues);
      break;
    case "PERCENTAGE":
      percentageInformation(value, path, issues);
      break;
    default:
      issue(issues, `${path}.kind`, "INVALID_CANONICAL_KIND", "Unknown canonical value kind.");
  }
  if (expectedKind !== null && value.kind !== expectedKind) {
    issue(
      issues,
      `${path}.kind`,
      "CANONICAL_KIND_MISMATCH",
      `The infoCode requires canonical kind ${expectedKind}.`,
    );
  }
  if (issues.length === startIssueCount) {
    try {
      assertCanonicalInformationValue(value as unknown as CanonicalInformationValue);
    } catch (error) {
      issue(
        issues,
        path,
        "INVALID_CANONICAL_VALUE",
        error instanceof Error ? error.message : "Canonical value validation failed.",
      );
    }
  }
  return value as unknown as CanonicalInformationValue;
}

function extractionCandidate(
  value: unknown,
  path: string,
  input: OrchestratorTurnInput,
  allowedCodes: ReadonlySet<string>,
  issues: OrchestratorContractIssue[],
): CanonicalExtractionCandidate | null {
  const record = strictObject(
    value,
    path,
    [
      "infoCode",
      "valueState",
      "value",
      "parserConfidence",
      "quality",
      "verification",
      "evidenceSpan",
      "missingFields",
      "proposedStatus",
      "terminalDisposition",
      "explanation",
    ],
    [],
    issues,
  );
  if (!record) return null;
  const infoCode = stringValue(record.infoCode, `${path}.infoCode`, issues, { nonEmpty: true });
  if (infoCode !== null && !allowedCodes.has(infoCode)) {
    issue(issues, `${path}.infoCode`, "UNKNOWN_INFO_CODE", `Unknown infoCode: ${infoCode}`);
  }
  const valueState = enumValue(record.valueState, VALUE_STATES, `${path}.valueState`, issues);
  const confidence = finiteNumber(record.parserConfidence, `${path}.parserConfidence`, issues, {
    minimum: 0,
    maximum: 1,
  });
  let quality: InformationQuality | null = null;
  if (record.quality !== null) {
    quality = enumValue(record.quality, QUALITIES, `${path}.quality`, issues);
  }
  const verification = enumValue(record.verification, EVIDENCE_KINDS, `${path}.verification`, issues);
  const span = textEvidenceSpan(record.evidenceSpan, `${path}.evidenceSpan`, input.text, issues);
  const missingFields = stringArray(record.missingFields, `${path}.missingFields`, issues);
  const proposedStatus = enumValue(
    record.proposedStatus,
    INFORMATION_STATUS_SET,
    `${path}.proposedStatus`,
    issues,
  );
  let terminalDisposition: CanonicalExtractionCandidate["terminalDisposition"] = null;
  if (record.terminalDisposition !== null) {
    terminalDisposition = enumValue(
      record.terminalDisposition,
      TERMINAL_DISPOSITIONS,
      `${path}.terminalDisposition`,
      issues,
    );
  }
  const explanation = stringValue(record.explanation, `${path}.explanation`, issues, {
    nonEmpty: true,
  });
  const expectedKind =
    DEV_V1_ALL_INFORMATION_CATALOG.find((definition) => definition.infoCode === infoCode)?.canonicalKind ??
    null;
  let parsedValue: CanonicalInformationValue | null = null;
  if (record.value !== null) {
    parsedValue = canonicalValue(record.value, `${path}.value`, input.text, expectedKind, issues);
  }

  if (valueState === "PRESENT") {
    if (record.value === null) {
      issue(issues, `${path}.value`, "VALUE_STATE_MISMATCH", "PRESENT requires a canonical value.");
    }
    if (quality === null) {
      issue(issues, `${path}.quality`, "VALUE_STATE_MISMATCH", "PRESENT requires information quality.");
    }
    if (terminalDisposition !== null) {
      issue(
        issues,
        `${path}.terminalDisposition`,
        "VALUE_STATE_MISMATCH",
        "PRESENT cannot have a terminal disposition.",
      );
    }
    if (proposedStatus !== null && !["CONFIRMED", "NEEDS_FOLLOWUP"].includes(proposedStatus)) {
      issue(
        issues,
        `${path}.proposedStatus`,
        "VALUE_STATE_MISMATCH",
        "A PRESENT candidate must propose CONFIRMED or NEEDS_FOLLOWUP.",
      );
    }
  } else if (valueState !== null) {
    if (record.value !== null) {
      issue(
        issues,
        `${path}.value`,
        "VALUE_STATE_MISMATCH",
        `${valueState} requires a null canonical value.`,
      );
    }
    if (record.quality !== null) {
      issue(issues, `${path}.quality`, "VALUE_STATE_MISMATCH", `${valueState} requires null quality.`);
    }
    const expectedDisposition =
      valueState === "REFUSED"
        ? "REFUSED"
        : valueState === "NOT_APPLICABLE"
          ? "NOT_APPLICABLE"
          : proposedStatus === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : null;
    if (terminalDisposition !== expectedDisposition) {
      issue(
        issues,
        `${path}.terminalDisposition`,
        "VALUE_STATE_MISMATCH",
        `Terminal disposition must be ${expectedDisposition ?? "null"} for this candidate.`,
      );
    }
  }

  if (
    infoCode === null ||
    valueState === null ||
    confidence === null ||
    verification === null ||
    span === null ||
    missingFields === null ||
    proposedStatus === null ||
    explanation === null
  ) {
    return null;
  }
  return {
    infoCode,
    valueState,
    value: parsedValue,
    parserConfidence: confidence,
    quality,
    verification,
    evidenceSpan: span,
    missingFields,
    proposedStatus,
    terminalDisposition,
    explanation,
  };
}

function validateStateChanges(
  value: unknown,
  input: OrchestratorTurnInput,
  candidates: ReadonlyMap<string, CanonicalExtractionCandidate>,
  allowedCodes: ReadonlySet<string>,
  issues: OrchestratorContractIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, "output.stateChanges", "INVALID_TYPE", "Expected an array.");
    return;
  }
  const statusByCode = new Map(input.informationItems.map((item) => [item.infoCode, item.status]));
  const seenTransitions = new Set<string>();
  value.forEach((entry, index) => {
    const path = `output.stateChanges[${index}]`;
    const record = strictObject(
      entry,
      path,
      ["infoCode", "from", "to", "reason", "incidentalExtraction"],
      [],
      issues,
    );
    if (!record) return;
    const infoCode = stringValue(record.infoCode, `${path}.infoCode`, issues, { nonEmpty: true });
    const from = enumValue(record.from, INFORMATION_STATUS_SET, `${path}.from`, issues);
    const to = enumValue(record.to, INFORMATION_STATUS_SET, `${path}.to`, issues);
    stringValue(record.reason, `${path}.reason`, issues, { nonEmpty: true });
    const incidental = booleanValue(record.incidentalExtraction, `${path}.incidentalExtraction`, issues);
    if (infoCode === null || from === null || to === null || incidental === null) return;
    if (!allowedCodes.has(infoCode)) {
      issue(issues, `${path}.infoCode`, "UNKNOWN_INFO_CODE", `Unknown infoCode: ${infoCode}`);
      return;
    }
    if (!candidates.has(infoCode)) {
      issue(
        issues,
        `${path}.infoCode`,
        "TRANSITION_WITHOUT_EXTRACTION",
        "Every proposed transition must belong to an extracted candidate.",
      );
    }
    const transitionKey = `${infoCode}\u0000${from}\u0000${to}`;
    if (seenTransitions.has(transitionKey)) {
      issue(issues, path, "DUPLICATE_STATE_TRANSITION", "Duplicate state transition.");
    }
    seenTransitions.add(transitionKey);
    const expectedFrom = statusByCode.get(infoCode);
    if (expectedFrom !== from) {
      issue(
        issues,
        `${path}.from`,
        "TRANSITION_FROM_MISMATCH",
        `Expected transition to start from ${expectedFrom ?? "an existing item state"}.`,
      );
    }
    if (!isInformationTransitionAllowed(from, to, { incidentalExtraction: incidental })) {
      issue(
        issues,
        path,
        "ILLEGAL_STATE_TRANSITION",
        `State transition ${from} -> ${to} is not allowed.`,
      );
    }
    statusByCode.set(infoCode, to);
  });

  if (!Array.isArray(value)) return;
  for (const [candidateCode, extracted] of candidates) {
    const candidate = (value as unknown[])
      .filter(isRecord)
      .filter((entry) => entry.infoCode === candidateCode);
    if (candidate.length === 0) continue;
    const finalTransition = candidate.at(-1);
    if (
      finalTransition &&
      typeof finalTransition.to === "string" &&
      finalTransition.to !== extracted.proposedStatus
    ) {
      issue(
        issues,
        "output.stateChanges",
        "CANDIDATE_TRANSITION_MISMATCH",
        `Final transition for ${candidateCode} must end at ${extracted.proposedStatus}.`,
      );
    }
  }
}

function validateNextQuestion(
  value: unknown,
  allowedCodes: ReadonlySet<string>,
  eligibleQuestions: readonly NextQuestion[],
  issues: OrchestratorContractIssue[],
): void {
  if (value === null) {
    if (eligibleQuestions.length > 0) {
      issue(
        issues,
        "output.nextQuestion",
        "NEXT_QUESTION_REQUIRED",
        "At least one server-eligible next question remains.",
      );
    }
    return;
  }
  const record = strictObject(
    value,
    "output.nextQuestion",
    ["infoCode", "text", "reason"],
    [],
    issues,
  );
  if (!record) return;
  const code = stringValue(record.infoCode, "output.nextQuestion.infoCode", issues, {
    nonEmpty: true,
  });
  if (code !== null && !allowedCodes.has(code)) {
    issue(
      issues,
      "output.nextQuestion.infoCode",
      "UNKNOWN_NEXT_QUESTION_CODE",
      `Unknown next-question infoCode: ${code}`,
    );
  }
  const eligible = code === null
    ? null
    : eligibleQuestions.find((question) => question.infoCode === code) ?? null;
  if (code !== null && !eligible) {
    issue(
      issues,
      "output.nextQuestion.infoCode",
      "NEXT_QUESTION_NOT_ELIGIBLE",
      "The next question must be selected from the server-generated eligible set.",
    );
  }
  stringValue(record.text, "output.nextQuestion.text", issues, { nonEmpty: true });
  const reason = enumValue(record.reason, NEXT_QUESTION_REASONS, "output.nextQuestion.reason", issues);
  if (eligible && reason !== null && reason !== eligible.reason) {
    issue(
      issues,
      "output.nextQuestion.reason",
      "NEXT_QUESTION_REASON_MISMATCH",
      `Expected ${eligible.reason} for ${eligible.infoCode}.`,
    );
  }
}

export function validateOrchestratorTurnPlan(
  output: unknown,
  input: OrchestratorTurnInput,
): OrchestratorContractIssue[] {
  const issues: OrchestratorContractIssue[] = [];
  const record = strictObject(
    output,
    "output",
    [
      "text",
      "currentInfoCode",
      "extractedItems",
      "stateChanges",
      "nextQuestion",
      "requiresPersistence",
    ],
    [],
    issues,
  );
  if (!record) return issues;
  const outputText = stringValue(record.text, "output.text", issues);
  if (outputText !== null && outputText !== input.text) {
    issue(
      issues,
      "output.text",
      "SOURCE_TEXT_MISMATCH",
      "The orchestrator must preserve the exact source transcript text.",
    );
  }
  if (record.currentInfoCode !== input.currentInfoCode) {
    issue(
      issues,
      "output.currentInfoCode",
      "CURRENT_INFO_CODE_MISMATCH",
      "The orchestrator cannot rewrite the active infoCode context.",
    );
  }
  booleanValue(record.requiresPersistence, "output.requiresPersistence", issues);
  if (record.requiresPersistence !== true) {
    issue(
      issues,
      "output.requiresPersistence",
      "PERSISTENCE_REQUIRED",
      "A FINAL transcript turn must require persistence.",
    );
  }

  const allowedCodes = new Set(input.informationItems.map((item) => item.infoCode));
  const candidates = new Map<string, CanonicalExtractionCandidate>();
  if (!Array.isArray(record.extractedItems)) {
    issue(issues, "output.extractedItems", "INVALID_TYPE", "Expected an array.");
  } else {
    record.extractedItems.forEach((entry, index) => {
      const candidate = extractionCandidate(
        entry,
        `output.extractedItems[${index}]`,
        input,
        allowedCodes,
        issues,
      );
      if (!candidate) return;
      if (candidates.has(candidate.infoCode)) {
        issue(
          issues,
          `output.extractedItems[${index}].infoCode`,
          "DUPLICATE_INFO_CODE",
          `Duplicate extracted infoCode: ${candidate.infoCode}`,
        );
      } else {
        candidates.set(candidate.infoCode, candidate);
      }
    });
  }

  validateStateChanges(record.stateChanges, input, candidates, allowedCodes, issues);
  const safeTransitions: ProposedInformationTransition[] = Array.isArray(record.stateChanges)
    ? record.stateChanges.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        if (
          typeof entry.infoCode !== "string" ||
          !INFORMATION_STATUSES.includes(entry.from as InformationStatus) ||
          !INFORMATION_STATUSES.includes(entry.to as InformationStatus) ||
          typeof entry.reason !== "string" ||
          typeof entry.incidentalExtraction !== "boolean"
        ) return [];
        return [{
          infoCode: entry.infoCode,
          from: entry.from as InformationStatus,
          to: entry.to as InformationStatus,
          reason: entry.reason,
          incidentalExtraction: entry.incidentalExtraction,
        }];
      })
    : [];
  const eligibleQuestions = selectTurnNextQuestionCandidates(
    input,
    safeTransitions,
    3,
  );
  validateNextQuestion(record.nextQuestion, allowedCodes, eligibleQuestions, issues);
  return issues;
}

export function assertOrchestratorTurnPlan(
  output: unknown,
  input: OrchestratorTurnInput,
): DeterministicTurnPlan {
  const issues = validateOrchestratorTurnPlan(output, input);
  if (issues.length > 0) throw new InvalidOrchestratorOutputError(issues);
  return output as DeterministicTurnPlan;
}

export function createValidatedOrchestratorProvider(
  provider: StructuredOrchestratorProvider,
): { plan: (input: OrchestratorTurnInput) => DeterministicTurnPlan } {
  return {
    plan(input) {
      return assertOrchestratorTurnPlan(provider.plan(input), input);
    },
  };
}
