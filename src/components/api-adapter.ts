import type {
  EvidenceKind,
  InformationCategory,
  InformationStatus,
  LiveInterviewSnapshot,
  ValueState,
} from "@/domain";

type UnknownRecord = Record<string, unknown>;

export type PillarKey = InformationCategory;
export type InformationBucketKey =
  | "completed"
  | "needed"
  | "followUp"
  | "conflict"
  | "terminal";

export interface PillarView {
  key: PillarKey;
  label: string;
  shortDescription: string;
  confirmationRate: number | null;
  evaluableRate: number | null;
  total: number | null;
  resolved: number | null;
}

export interface EvidenceView {
  id: string;
  infoCode: string;
  kind: EvidenceKind | string;
  kindLabel: string;
  source: string;
  transcriptSegmentId: string | null;
  linkedTranscript: TranscriptView | null;
  excerpt: string | null;
  observedAt: string | null;
}

export interface InformationItemView {
  id: string;
  infoCode: string;
  label: string;
  category: PillarKey;
  categoryLabel: string;
  priority: string;
  required: boolean;
  status: InformationStatus;
  statusLabel: string;
  valueState: ValueState;
  valueStateLabel: string;
  displayValue: string | null;
  verificationLabel: string | null;
  quality: string | null;
  updatedAt: string | null;
  bucket: InformationBucketKey;
  evidenceIds: string[];
  dataQualityScore: number | null;
  dataQualityGrade: string | null;
  dataQualitySource: string | null;
  dataQualityAsOf: string | null;
  dataQualitySummary: string | null;
}

export interface TranscriptView {
  id: string;
  speaker: "ASSISTANT" | "BORROWER";
  text: string;
  rawText: string;
  correctedText: string | null;
  revision: number;
  startMs: number | null;
  endMs: number | null;
  sttConfidence: number | null;
  sttProvider: string | null;
  createdAt: string;
}

export interface LiveFeatureView {
  name: string;
  domain: string;
  state: string;
  raw: string | null;
  normalized: number | null;
  sourceInfoCodes: string[];
  evidenceIds: string[];
  formula: string | null;
  reason: string | null;
}

export interface LiveFeaturePreviewChangeView {
  name: string;
  previousState: string;
  currentState: string;
  previousRaw: string | null;
  currentRaw: string | null;
  previousNormalized: number | null;
  currentNormalized: number | null;
}

export interface InformationItemPreviewChangeView {
  infoCode: string;
  label: string;
  previousStatus: InformationStatus;
  currentStatus: InformationStatus;
  currentStatusLabel: string;
  previousBucket: InformationBucketKey;
  currentBucket: InformationBucketKey;
  previousDisplayValue: string | null;
  currentDisplayValue: string | null;
  evidenceCount: number;
}

/**
 * Allow-listed telemetry from MessageProcessingResult.processing. This view
 * deliberately has no request identifier, prompt, response body, credential,
 * or provider error field, so those values cannot accidentally reach the UI.
 */
export interface MessageProcessingTelemetryView {
  status: "APPLIED" | "RETRYABLE_FAILURE" | "NON_RETRYABLE_FAILURE";
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
}

export interface PendingMessageCommandView {
  text: string;
  clientMessageId: string;
  expectedVersion: number;
  currentQuestionInfoCode: string | null;
  transcriptMetadata: {
    startMs: number | null;
    endMs: number | null;
    sttConfidence: number | null;
    sttProvider: string | null;
  } | null;
  processingState: "READY" | "PROCESSING";
}

/**
 * Compares two authoritative server snapshots for presentation only. The
 * browser never infers an information value or transition; it merely makes a
 * persisted status/value/evidence change visible to the interviewer.
 */
export function diffInformationItemSnapshots(
  previous: readonly InformationItemView[],
  current: readonly InformationItemView[],
): InformationItemPreviewChangeView[] {
  const previousByCode = new Map(previous.map((item) => [item.infoCode, item]));
  return current.flatMap((item) => {
    const before = previousByCode.get(item.infoCode);
    if (!before) return [];
    const evidenceChanged =
      before.evidenceIds.length !== item.evidenceIds.length ||
      before.evidenceIds.some((evidenceId, index) => evidenceId !== item.evidenceIds[index]);
    if (
      before.status === item.status &&
      before.displayValue === item.displayValue &&
      !evidenceChanged
    ) {
      return [];
    }
    return [{
      infoCode: item.infoCode,
      label: item.label,
      previousStatus: before.status,
      currentStatus: item.status,
      currentStatusLabel: item.statusLabel,
      previousBucket: before.bucket,
      currentBucket: item.bucket,
      previousDisplayValue: before.displayValue,
      currentDisplayValue: item.displayValue,
      evidenceCount: item.evidenceIds.length,
    }];
  });
}

/**
 * Compares two server-produced feature snapshots for presentation only. It
 * never derives a feature value or score in the browser.
 */
export function diffLiveFeatureSnapshots(
  previous: readonly LiveFeatureView[],
  current: readonly LiveFeatureView[],
): LiveFeaturePreviewChangeView[] {
  const previousByName = new Map(previous.map((feature) => [feature.name, feature]));
  return current.flatMap((feature) => {
    const before = previousByName.get(feature.name);
    if (!before) return [];
    const changed =
      before.state !== feature.state ||
      before.raw !== feature.raw ||
      before.normalized !== feature.normalized;
    return changed
      ? [{
          name: feature.name,
          previousState: before.state,
          currentState: feature.state,
          previousRaw: before.raw,
          currentRaw: feature.raw,
          previousNormalized: before.normalized,
          currentNormalized: feature.normalized,
        }]
      : [];
  });
}

export interface LiveInterviewView {
  id: string;
  lifecycleStatus: string;
  version: number;
  lastEventSeq: number;
  snapshotType: "PREVIEW";
  borrowerName: string;
  businessName: string;
  industry: string;
  currentQuestionInfoCode: string | null;
  currentQuestion: string | null;
  questionReason: string | null;
  transcript: TranscriptView[];
  informationItems: InformationItemView[];
  buckets: Record<InformationBucketKey, InformationItemView[]>;
  pillars: PillarView[];
  overallRate: number | null;
  requiredInformationRate: number | null;
  totalRequired: number | null;
  resolvedRequired: number | null;
  unresolvedRequired: number | null;
  unresolvedP0: number | null;
  evidence: EvidenceView[];
  featureRegistryVersion: string | null;
  featureStateVersion: number | null;
  features: LiveFeatureView[];
  liveSummary: string | null;
  goal: GoalView | null;
  updatedAt: string | null;
  pendingCommand: PendingMessageCommandView | null;
}

export interface FinalInterviewView {
  id: string;
  interviewId: string;
  lifecycleStatus: "COMPLETE" | "INCOMPLETE";
  version: number;
  lastEventSeq: number;
  snapshotType: "FINAL";
  completionStatus: "COMPLETE" | "INCOMPLETE";
  finalizedAt: string | null;
  borrowerName: string;
  businessName: string;
  industry: string;
  informationItems: InformationItemView[];
  evidence: EvidenceView[];
  transcriptSummary: string | null;
  overallRate: number | null;
  evaluationEligible: boolean;
  evaluationId: string | null;
}

export type InterviewSnapshotView = LiveInterviewView | FinalInterviewView;

export interface EvaluationPillarView extends PillarView {
  score: number | null;
  level: string;
  levelLabel: string;
  summary: string;
  /** Exact feature names persisted by the server for this pillar score. */
  contributingFeatureNames: string[];
  /** Exact evidence identifiers persisted by the server for this pillar score. */
  contributingEvidenceIds: string[];
}

export interface EvaluationPillarLineageView {
  contributingFeatures: LiveFeatureView[];
  referenceFeatures: LiveFeatureView[];
  missingContributingFeatureNames: string[];
  contributingInformation: InformationItemView[];
  referenceInformation: InformationItemView[];
  contributingEvidence: EvidenceView[];
  referenceEvidence: EvidenceView[];
  missingContributingEvidenceIds: string[];
}

export interface GoalView {
  title: string | null;
  baseline: string | null;
  target: string | null;
  period: string | null;
  unit: string | null;
  measurementSource: string | null;
  status: string | null;
  numericStatus: string | null;
  origin: string | null;
  context: string | null;
  behaviorEvent: {
    eventName: string | null;
    window: string | null;
    metric: string | null;
    aggregation: string | null;
    source: string | null;
  } | null;
  evidenceIds: string[];
}

export interface OfficialCbView {
  score: string | null;
  grade: string | null;
  source: string | null;
  observedAt: string | null;
}

export interface EvaluationView {
  id: string;
  interviewId: string;
  finalSnapshotId: string;
  snapshotVersion: number;
  status: string;
  disclaimer: string;
  createdAt: string;
  overallScore: number | null;
  overallLevel: string;
  overallLevelLabel: string;
  completionStatus: string;
  borrowerName: string | null;
  businessName: string | null;
  industry: string | null;
  transcriptSummary: string | null;
  pillars: EvaluationPillarView[];
  unresolvedItems: Array<{
    infoCode: string;
    label: string;
    priority: string;
    required: boolean;
    status: string;
    statusLabel: string;
  }>;
  evidence: EvidenceView[];
  officialCb: OfficialCbView | null;
  goal: GoalView | null;
  contextAvailable: boolean;
  decisionScope: string;
  gradeScope: string | null;
  features: LiveFeatureView[];
  sourceInformation: InformationItemView[];
  summarySections: Array<{
    kind: string;
    text: string;
    evidenceIds: string[];
    gapStatement: boolean;
  }>;
}

export interface EvaluationListItemView {
  id: string;
  interviewId: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  borrowerName: string | null;
  businessName: string | null;
  industry: string | null;
  overallScore: number | null;
  overallLevel: string;
  overallLevelLabel: string;
  informationRate: number | null;
  goalCount: number;
  completionStatus: string;
}

export interface EvaluationListView {
  items: EvaluationListItemView[];
  total: number;
  facets: {
    industries: string[];
    levels: string[];
  };
}

/**
 * Selects evaluation detail rows from the server-persisted pillar lineage.
 * Feature and evidence contribution is never inferred from matching domains.
 * Required source information is separated because it is part of the pillar's
 * coverage denominator; optional information remains reference-only.
 */
export function selectEvaluationPillarLineage(
  evaluation: EvaluationView,
  pillar: EvaluationPillarView,
): EvaluationPillarLineageView {
  const featuresByName = new Map(
    evaluation.features.map((feature) => [feature.name, feature] as const),
  );
  const contributingFeatures = pillar.contributingFeatureNames.flatMap((name) => {
    const feature = featuresByName.get(name);
    return feature ? [feature] : [];
  });
  const contributingFeatureNameSet = new Set(pillar.contributingFeatureNames);
  const referenceFeatures = evaluation.features.filter(
    (feature) =>
      feature.domain === pillar.key && !contributingFeatureNameSet.has(feature.name),
  );
  const missingContributingFeatureNames = pillar.contributingFeatureNames.filter(
    (name) => !featuresByName.has(name),
  );

  const categoryInformation = evaluation.sourceInformation.filter(
    (item) => item.category === pillar.key,
  );
  const contributingInformation = categoryInformation.filter((item) => item.required);
  const referenceInformation = categoryInformation.filter((item) => !item.required);

  const evidenceById = new Map(
    evaluation.evidence.map((evidence) => [evidence.id, evidence] as const),
  );
  const contributingEvidence = pillar.contributingEvidenceIds.flatMap((id) => {
    const evidence = evidenceById.get(id);
    return evidence ? [evidence] : [];
  });
  const contributingEvidenceIdSet = new Set(pillar.contributingEvidenceIds);
  const referenceEvidenceIds = new Set([
    ...categoryInformation.flatMap((item) => item.evidenceIds),
    ...referenceFeatures.flatMap((feature) => feature.evidenceIds),
  ]);
  const referenceEvidence = evaluation.evidence.filter(
    (evidence) =>
      referenceEvidenceIds.has(evidence.id) && !contributingEvidenceIdSet.has(evidence.id),
  );
  const missingContributingEvidenceIds = pillar.contributingEvidenceIds.filter(
    (id) => !evidenceById.has(id),
  );

  return {
    contributingFeatures,
    referenceFeatures,
    missingContributingFeatureNames,
    contributingInformation,
    referenceInformation,
    contributingEvidence,
    referenceEvidence,
    missingContributingEvidenceIds,
  };
}

const CATEGORY_META: Record<
  InformationCategory,
  { label: string; description: string }
> = {
  CURRENT_STATE: {
    label: "현재 상황",
    description: "매출·비용·부채와 사업 운영 현황",
  },
  FUTURE_OUTLOOK: {
    label: "미래 전망",
    description: "수요·매출 전망과 그 근거",
  },
  IMPROVEMENT_INTENT: {
    label: "개선 의지",
    description: "차주의 실행 계획과 목표",
  },
  HOUSEHOLD_STATE: {
    label: "가계 상황",
    description: "가계 지출과 자금 여력",
  },
};

const CATEGORY_ORDER: InformationCategory[] = [
  "CURRENT_STATE",
  "FUTURE_OUTLOOK",
  "IMPROVEMENT_INTENT",
  "HOUSEHOLD_STATE",
];

const STATUS_LABELS: Record<InformationStatus, string> = {
  NEEDED: "수집 필요",
  ASKING: "질문 중",
  COLLECTED: "답변 수집",
  CONFIRMED: "확인 완료",
  NEEDS_FOLLOWUP: "추가 확인",
  CONFLICT: "정보 충돌",
  UNAVAILABLE: "확인 불가",
  REFUSED: "응답 거절",
  NOT_APPLICABLE: "해당 없음",
};

const VALUE_STATE_LABELS: Record<ValueState, string> = {
  PRESENT: "값 있음",
  MISSING: "값 없음",
  UNKNOWN: "알 수 없음",
  REFUSED: "응답 거절",
  NOT_APPLICABLE: "해당 없음",
};

const EVIDENCE_KIND_LABELS: Record<string, string> = {
  SELF_REPORTED: "차주 진술",
  DOCUMENT_SUPPORTED: "서류 확인",
  TRANSACTION_SUPPORTED: "거래 확인",
  SYSTEM_DERIVED: "시스템 산출",
  CONFLICTING: "상충 근거",
  UNKNOWN: "출처 미확인",
};

const LEVEL_LABELS: Record<string, string> = {
  SUFFICIENT: "충분",
  PARTIAL: "일부 충분",
  INSUFFICIENT: "불충분",
  A: "A · 데이터 품질",
  B: "B · 데이터 품질",
  C: "C · 데이터 품질",
  D: "D · 데이터 품질",
  E: "E · 데이터 품질",
  UNGRADED: "등급 미산정",
};

const INFO_LABELS: Record<string, string> = {
  monthly_average_sales: "월평균 매출",
  fixed_operating_costs: "월 고정 운영비",
  improvement_plan: "사업 개선 계획",
  execution_readiness: "실행 준비도",
  confirmed_reservations: "확정 예약 건수",
  seasonality_outlook: "계절성 전망",
  essential_household_expenses: "월 필수 가계지출",
  emergency_buffer_months: "가계 비상자금 보유기간",
};

export class ApiRequestError extends Error {
  readonly blockers: string[];
  readonly code: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    blockers: string[] = [],
    code: string | null = null,
    status: number | null = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.blockers = blockers;
    this.code = code;
    this.status = status;
  }
}

const MESSAGE_RETRY_RESYNC_ERROR_CODES = new Set([
  "MESSAGE_STAGE_STALE",
  "MESSAGE_STAGE_PENDING",
  "MESSAGE_STAGE_BUSY",
  "MESSAGE_STAGE_CLAIM_LOST",
  "MESSAGE_STAGE_CONFLICT",
  "MESSAGE_STAGE_RECEIPT_MISSING",
  "VERSION_CONFLICT",
  "STALE_QUESTION",
  "INTERVIEW_FINALIZED",
]);

export function shouldClearPendingMessageRetry(error: unknown): boolean {
  return error instanceof ApiRequestError &&
    error.code !== null &&
    MESSAGE_RETRY_RESYNC_ERROR_CODES.has(error.code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function telemetryText(value: unknown, maximumLength: number): string | null {
  const text = stringValue(value);
  if (
    !text ||
    text.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    return null;
  }
  return text;
}

function telemetryTokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function pendingMessageCommandView(value: unknown): PendingMessageCommandView | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === "string" ? value.text : "";
  const clientMessageId = stringValue(value.clientMessageId);
  const expectedVersion = numberValue(value.expectedVersion);
  const question = value.currentQuestionInfoCode;
  const processingState = value.processingState;
  if (
    !text.trim() ||
    text.length > 5_000 ||
    !clientMessageId ||
    clientMessageId.length > 128 ||
    expectedVersion === null ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    (question !== null &&
      (typeof question !== "string" || !question.trim() || question.length > 128)) ||
    (processingState !== "READY" && processingState !== "PROCESSING")
  ) {
    return null;
  }

  const metadataValue = value.transcriptMetadata;
  let transcriptMetadata: PendingMessageCommandView["transcriptMetadata"] = null;
  if (metadataValue !== null && metadataValue !== undefined) {
    if (!isRecord(metadataValue)) return null;
    const nullableNumber = (candidate: unknown): number | null | undefined =>
      candidate === null
        ? null
        : typeof candidate === "number" && Number.isFinite(candidate)
          ? candidate
          : undefined;
    const startMs = nullableNumber(metadataValue.startMs);
    const endMs = nullableNumber(metadataValue.endMs);
    const sttConfidence = nullableNumber(metadataValue.sttConfidence);
    const provider = metadataValue.sttProvider;
    if (
      startMs === undefined ||
      endMs === undefined ||
      sttConfidence === undefined ||
      (startMs !== null && startMs < 0) ||
      (endMs !== null && endMs < 0) ||
      (startMs !== null && endMs !== null && endMs < startMs) ||
      (sttConfidence !== null && (sttConfidence < 0 || sttConfidence > 1)) ||
      (provider !== null &&
        (typeof provider !== "string" || !provider.trim() || provider.length > 128))
    ) {
      return null;
    }
    transcriptMetadata = {
      startMs,
      endMs,
      sttConfidence,
      sttProvider: typeof provider === "string" ? provider.trim() : null,
    };
  }

  return {
    text,
    clientMessageId,
    expectedVersion,
    currentQuestionInfoCode: typeof question === "string" ? question.trim() : null,
    transcriptMetadata,
    processingState,
  };
}

/**
 * Reads only the public, bounded processing telemetry that the live interview may
 * display. It accepts both a MessageProcessingResult and an SSE event data
 * object. Any requestId, prompt, raw response, credential, or unknown metadata
 * member is ignored by construction.
 */
export function extractMessageProcessingTelemetry(
  input: unknown,
): MessageProcessingTelemetryView | null {
  if (!isRecord(input)) return null;
  const envelopeData = isRecord(input.data) ? input.data : null;
  const processing = isRecord(input.processing)
    ? input.processing
    : envelopeData && isRecord(envelopeData.processing)
      ? envelopeData.processing
      : null;
  if (!processing) return null;

  const status = stringValue(processing.status);
  if (
    status !== "APPLIED" &&
    status !== "RETRYABLE_FAILURE" &&
    status !== "NON_RETRYABLE_FAILURE"
  ) return null;
  const metadata = isRecord(processing.metadata) ? processing.metadata : null;

  return {
    status,
    provider: telemetryText(metadata?.provider, 40),
    model: telemetryText(metadata?.model, 120),
    inputTokens: telemetryTokenCount(metadata?.inputTokens),
    outputTokens: telemetryTokenCount(metadata?.outputTokens),
    stopReason: telemetryText(metadata?.stopReason, 80),
  };
}

function percentValue(value: unknown): number | null {
  const number = numberValue(value);
  if (number === null) return null;
  const percent = number > 0 && number <= 1 ? number * 100 : number;
  return Math.min(100, Math.max(0, percent));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return null;
      return (
        stringValue(item.message) ??
        stringValue(item.label) ??
        stringValue(item.infoCode)
      );
    })
    .filter((item): item is string => item !== null);
}

function nestedRecord(record: UnknownRecord, keys: string[]): UnknownRecord | null {
  for (const key of keys) {
    if (isRecord(record[key])) return record[key];
  }
  return null;
}

function formatInformationValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("ko-KR").format(value);
  }
  if (!isRecord(value)) return null;

  const canonicalKind = stringValue(value.kind);
  if (canonicalKind === "PERIODIC_MONEY" && isRecord(value.amount)) {
    const measure = formatNumericMeasure(value.amount, "원");
    return measure ? `${measure} / 월` : null;
  }
  if (canonicalKind === "CONFIRMED_RESERVATIONS" && isRecord(value.count)) {
    return formatNumericMeasure(value.count, "건");
  }
  if (canonicalKind === "DURATION" && isRecord(value.duration)) {
    return formatNumericMeasure(
      value.duration,
      value.unit === "MONTH" ? "개월" : value.unit === "WEEK" ? "주" : "",
    );
  }
  if (canonicalKind === "PERCENTAGE" && isRecord(value.percentage)) {
    return formatNumericMeasure(value.percentage, "%");
  }
  if (canonicalKind === "BUSINESS_SIGNAL") {
    const observed = value.observed === true;
    const signal = stringValue(value.signal);
    if (signal === "PLATFORM_FEE_PRESSURE") {
      return observed ? "플랫폼 비용부담 확인" : "플랫폼 비용부담 없음";
    }
    if (signal === "HALL_CUSTOMER_DECLINE") {
      return observed ? "홀매출 감소 확인" : "홀매출 감소 없음";
    }
    return observed ? "확인" : "해당 없음";
  }
  if (canonicalKind === "IMPROVEMENT_PLAN") {
    if (value.planExists === false) return "명시된 개선 계획 없음";
    const actions = Array.isArray(value.actions)
      ? value.actions
          .map((action) => (isRecord(action) ? stringValue(action.text) : null))
          .filter((action): action is string => action !== null)
      : [];
    return actions[0] ?? stringValue(value.problem) ?? "개선 계획 있음";
  }
  if (canonicalKind === "EXECUTION_READINESS") {
    const readiness = stringValue(value.state);
    return readiness
      ? ({ READY: "실행 준비 완료", PARTIAL: "일부 준비", NOT_STARTED: "준비 전" }[readiness] ?? readiness)
      : null;
  }
  if (canonicalKind === "SEASONALITY_OUTLOOK") {
    const direction = stringValue(value.direction);
    return direction
      ? ({ UP: "향후 수요 증가", FLAT: "향후 수요 보합", DOWN: "향후 수요 감소", UNKNOWN: "전망 불명" }[direction] ?? direction)
      : null;
  }

  const amount = numberValue(value.amount);
  if (amount !== null) {
    const formatted = new Intl.NumberFormat("ko-KR").format(amount);
    const period = value.period === "MONTH" ? " / 월" : "";
    return `${formatted}원${period}`;
  }

  const min = numberValue(value.min);
  const max = numberValue(value.max);
  const unit = stringValue(value.unit) ?? "";
  if (min !== null || max !== null) {
    if (min !== null && max !== null) {
      return `${new Intl.NumberFormat("ko-KR").format(min)}~${new Intl.NumberFormat("ko-KR").format(max)}${unit}`;
    }
    const available = min ?? max;
    return available === null
      ? null
      : `${new Intl.NumberFormat("ko-KR").format(available)}${unit}`;
  }

  return null;
}

function formatNumericMeasure(value: UnknownRecord, unit: string): string | null {
  if (value.kind === "EXACT") {
    const exact = numberValue(value.value);
    return exact === null
      ? null
      : `${new Intl.NumberFormat("ko-KR").format(exact)}${unit}`;
  }
  if (value.kind === "RANGE") {
    const min = numberValue(value.min);
    const max = numberValue(value.max);
    return min === null || max === null
      ? null
      : `${new Intl.NumberFormat("ko-KR").format(min)}~${new Intl.NumberFormat("ko-KR").format(max)}${unit}`;
  }
  return null;
}

function formatRatioMeasureAsPercent(value: UnknownRecord): string | null {
  if (value.kind === "EXACT") {
    const exact = numberValue(value.value);
    return exact === null
      ? null
      : `${new Intl.NumberFormat("ko-KR").format(exact * 100)}%`;
  }
  if (value.kind === "RANGE") {
    const min = numberValue(value.min);
    const max = numberValue(value.max);
    return min === null || max === null
      ? null
      : `${new Intl.NumberFormat("ko-KR").format(min * 100)}~${new Intl.NumberFormat("ko-KR").format(max * 100)}%`;
  }
  return null;
}

function bucketForStatus(status: InformationStatus): InformationBucketKey {
  switch (status) {
    case "CONFIRMED":
      return "completed";
    case "NEEDED":
    case "ASKING":
      return "needed";
    case "CONFLICT":
      return "conflict";
    case "COLLECTED":
    case "NEEDS_FOLLOWUP":
      return "followUp";
    case "UNAVAILABLE":
    case "REFUSED":
    case "NOT_APPLICABLE":
      return "terminal";
  }
}

function transcriptView(value: unknown): TranscriptView | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const speaker = stringValue(value.speaker);
  const text = stringValue(value.text);
  if (!id || !text || (speaker !== "ASSISTANT" && speaker !== "BORROWER")) {
    return null;
  }

  return {
    id,
    speaker,
    text,
    rawText: stringValue(value.rawText) ?? text,
    correctedText: stringValue(value.correctedText),
    revision: numberValue(value.revision) ?? 1,
    startMs: numberValue(value.startMs),
    endMs: numberValue(value.endMs),
    sttConfidence: numberValue(value.sttConfidence),
    sttProvider: stringValue(value.sttProvider),
    createdAt: stringValue(value.createdAt) ?? "",
  };
}

function transcriptViews(value: unknown): TranscriptView[] {
  return Array.isArray(value)
    ? value
        .map(transcriptView)
        .filter((item): item is TranscriptView => item !== null)
    : [];
}

function evidenceView(
  value: unknown,
  transcriptsById: ReadonlyMap<string, TranscriptView> = new Map(),
): EvidenceView | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  const kind = stringValue(value.kind) ?? "UNKNOWN";
  const transcriptSegmentId = stringValue(value.transcriptSegmentId);

  return {
    id,
    infoCode: stringValue(value.infoCode) ?? "",
    kind,
    kindLabel: EVIDENCE_KIND_LABELS[kind] ?? kind,
    source: stringValue(value.source) ?? "출처 미확인",
    transcriptSegmentId,
    linkedTranscript: transcriptSegmentId
      ? transcriptsById.get(transcriptSegmentId) ?? null
      : null,
    excerpt: stringValue(value.excerpt),
    observedAt: stringValue(value.observedAt),
  };
}

function snapshotRecord(input: unknown): UnknownRecord {
  if (!isRecord(input)) {
    throw new Error("인터뷰 응답 형식을 확인할 수 없습니다.");
  }

  if (
    (isRecord(input.session) || input.snapshotType === "FINAL") &&
    Array.isArray(input.informationItems)
  ) {
    return input;
  }

  const nested = nestedRecord(input, ["snapshot", "liveSnapshot"]);
  if (
    nested &&
    (isRecord(nested.session) || nested.snapshotType === "FINAL") &&
    Array.isArray(nested.informationItems)
  ) {
    return nested;
  }

  throw new Error("인터뷰 스냅샷이 응답에 포함되지 않았습니다.");
}

function informationItemViews(input: unknown): InformationItemView[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value): InformationItemView | null => {
      if (!isRecord(value)) return null;
      const infoCode = stringValue(value.infoCode);
      const category = stringValue(value.category) as InformationCategory | null;
      const status = stringValue(value.status) as InformationStatus | null;
      const valueState = stringValue(value.valueState) as ValueState | null;
      if (!infoCode || !category || !status || !valueState) return null;
      const selectedRevisionId = stringValue(value.selectedRevisionId);
      const revisions = Array.isArray(value.revisions)
        ? value.revisions.filter(isRecord)
        : [];
      const selectedRevision = selectedRevisionId
        ? revisions.find((revision) => stringValue(revision.id) === selectedRevisionId) ?? null
        : null;
      const effectiveValue = selectedRevision?.value ?? value.value;
      const verification =
        stringValue(selectedRevision?.verification) ?? stringValue(value.verification);
      const evidenceIds = selectedRevision
        ? asStringArray(selectedRevision.evidenceIds)
        : asStringArray(value.evidenceIds);
      return {
        id: infoCode,
        infoCode,
        label: stringValue(value.label) ?? INFO_LABELS[infoCode] ?? infoCode,
        category,
        categoryLabel: CATEGORY_META[category]?.label ?? category,
        priority: stringValue(value.priority) ?? "P2",
        required: typeof value.required === "boolean" ? value.required : true,
        status,
        statusLabel: STATUS_LABELS[status] ?? status,
        valueState,
        valueStateLabel: VALUE_STATE_LABELS[valueState] ?? valueState,
        displayValue: formatInformationValue(effectiveValue),
        verificationLabel: verification
          ? (EVIDENCE_KIND_LABELS[verification] ?? verification)
          : null,
        quality: stringValue(selectedRevision?.quality) ?? stringValue(value.quality),
        updatedAt: stringValue(value.updatedAt),
        bucket: bucketForStatus(status),
        evidenceIds,
        dataQualityScore: null,
        dataQualityGrade: null,
        dataQualitySource: null,
        dataQualityAsOf: null,
        dataQualitySummary: null,
      };
    })
    .filter((item): item is InformationItemView => item !== null);
}

function liveFeatureViews(input: unknown): LiveFeatureView[] {
  const container = isRecord(input) ? input : null;
  if (!container || !Array.isArray(container.features)) return [];

  return container.features.flatMap((value) => {
    if (!isRecord(value)) return [];
    const name = stringValue(value.name);
    if (!name) return [];
    const rawRecord = isRecord(value.raw) ? value.raw : null;
    const rubricLevel = rawRecord ? numberValue(rawRecord.level) : null;
    const confirmedReservations = rawRecord && isRecord(rawRecord.confirmedReservations)
      ? formatNumericMeasure(rawRecord.confirmedReservations, "건")
      : null;
    const basisCount = rawRecord && Array.isArray(rawRecord.bases)
      ? rawRecord.bases.length
      : 0;
    const numericRaw = rawRecord
      ? name === "repeat_customer_share"
        ? formatRatioMeasureAsPercent(rawRecord)
        : formatNumericMeasure(rawRecord, stringValue(rawRecord.unit) ?? "")
      : null;
    const raw =
      (rubricLevel !== null && stringValue(rawRecord?.reason)
        ? `${rubricLevel} / 5`
        : confirmedReservations
          ? `확정수요 ${confirmedReservations} · 근거 ${basisCount}개`
          : numericRaw) ??
      formatInformationValue(value.raw) ??
      (value.raw === null || value.raw === undefined
        ? null
        : typeof value.raw === "string"
          ? value.raw
          : typeof value.raw === "number" || typeof value.raw === "boolean"
            ? String(value.raw)
            : "구조화 값");
    return [
      {
        name,
        domain: stringValue(value.domain) ?? "UNKNOWN",
        state: stringValue(value.state) ?? "MISSING",
        raw,
        normalized: numberValue(value.normalized),
        sourceInfoCodes: asStringArray(value.sourceInfoCodes),
        evidenceIds: asStringArray(value.evidenceIds),
        formula: stringValue(value.formula),
        reason: stringValue(value.reason),
      },
    ];
  });
}

export function adaptLiveSnapshot(input: unknown): LiveInterviewView {
  const record = snapshotRecord(input);
  const snapshot = record as unknown as LiveInterviewSnapshot;
  const session = snapshot.session;
  const coverage = snapshot.coverage;
  const summaryRecord = isRecord(record.liveSummary) ? record.liveSummary : null;
  const optionalSummary =
    stringValue(record.liveSummary) ?? stringValue(summaryRecord?.plainText);
  const totalRequired = numberValue(coverage.totalRequired);
  const resolvedRequired = numberValue(coverage.resolvedRequired);

  const informationItems = informationItemViews(snapshot.informationItems);
  const featuresRecord = isRecord(record.features) ? record.features : null;
  const features = liveFeatureViews(featuresRecord);
  const transcript = transcriptViews(snapshot.transcript);
  const transcriptsById = new Map(transcript.map((segment) => [segment.id, segment]));

  const buckets: Record<InformationBucketKey, InformationItemView[]> = {
    completed: [],
    needed: [],
    followUp: [],
    conflict: [],
    terminal: [],
  };
  for (const item of informationItems) buckets[item.bucket].push(item);
  for (const items of Object.values(buckets)) {
    items.sort((left, right) => {
      const leftCurrent = left.infoCode === snapshot.nextQuestion?.infoCode;
      const rightCurrent = right.infoCode === snapshot.nextQuestion?.infoCode;
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      const leftAsking = left.status === "ASKING";
      const rightAsking = right.status === "ASKING";
      if (leftAsking !== rightAsking) return leftAsking ? -1 : 1;
      return 0;
    });
  }

  const pillars: PillarView[] = CATEGORY_ORDER.map((category) => {
    const categoryCoverage = coverage.byCategory[category];
    return {
      key: category,
      label: CATEGORY_META[category].label,
      shortDescription: CATEGORY_META[category].description,
      confirmationRate: percentValue(categoryCoverage?.confirmationRate),
      evaluableRate: percentValue(categoryCoverage?.evaluableRate),
      total: numberValue(categoryCoverage?.total),
      resolved: numberValue(categoryCoverage?.resolved),
    };
  });

  return {
    id: session.id,
    lifecycleStatus: session.lifecycleStatus,
    version: session.version,
    lastEventSeq:
      numberValue((session as unknown as UnknownRecord).lastEventSeq) ?? 0,
    snapshotType: "PREVIEW",
    borrowerName: snapshot.borrower.name,
    businessName: snapshot.business.businessName,
    industry: snapshot.business.industry,
    currentQuestionInfoCode: snapshot.nextQuestion?.infoCode ?? null,
    currentQuestion: snapshot.nextQuestion?.text ?? null,
    questionReason: snapshot.nextQuestion?.reason ?? null,
    transcript,
    informationItems,
    buckets,
    pillars,
    overallRate: percentValue(coverage.overallRate),
    requiredInformationRate: percentValue(coverage.requiredInformationRate),
    totalRequired,
    resolvedRequired,
    unresolvedRequired:
      totalRequired !== null && resolvedRequired !== null
        ? Math.max(0, totalRequired - resolvedRequired)
        : informationItems.filter(
            (item) =>
              item.required &&
              !["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(item.status),
          ).length,
    unresolvedP0: numberValue(coverage.unresolvedP0),
    evidence: snapshot.evidence
      .map((value) => evidenceView(value, transcriptsById))
      .filter((item): item is EvidenceView => item !== null),
    featureRegistryVersion: stringValue(featuresRecord?.registryVersion),
    featureStateVersion: numberValue(featuresRecord?.stateVersion),
    features,
    liveSummary: optionalSummary,
    goal: optionalGoal(record, null),
    updatedAt: session.updatedAt,
    pendingCommand: pendingMessageCommandView(record.pendingCommand),
  };
}

export function adaptFinalSnapshot(input: unknown): FinalInterviewView {
  const record = snapshotRecord(input);
  const session = isRecord(record.session) ? record.session : {};
  const borrower = isRecord(record.borrower) ? record.borrower : {};
  const business = isRecord(record.business) ? record.business : {};
  const coverage = isRecord(record.coverage) ? record.coverage : {};
  const informationItems = informationItemViews(record.informationItems);
  const evidenceSource = Array.isArray(record.evidenceManifest)
    ? record.evidenceManifest
    : Array.isArray(record.evidence)
      ? record.evidence
      : [];
  const completionStatus =
    stringValue(record.completionStatus) === "COMPLETE" ? "COMPLETE" : "INCOMPLETE";
  const evaluation = isRecord(record.evaluation) ? record.evaluation : null;

  return {
    id: stringValue(record.id) ?? stringValue(session.id) ?? "",
    interviewId:
      stringValue(record.interviewId) ?? stringValue(session.id) ?? "",
    lifecycleStatus: completionStatus,
    version:
      numberValue(record.version) ??
      numberValue(record.stateVersion) ??
      numberValue(session.version) ??
      0,
    lastEventSeq: numberValue(session.lastEventSeq) ?? 0,
    snapshotType: "FINAL",
    completionStatus,
    finalizedAt: stringValue(record.finalizedAt) ?? stringValue(session.completedAt),
    borrowerName: stringValue(borrower.name) ?? "차주 정보 없음",
    businessName: stringValue(business.businessName) ?? "사업체 정보 없음",
    industry: stringValue(business.industry) ?? "업종 정보 없음",
    informationItems,
    evidence: evidenceSource
      .map((value) => evidenceView(value))
      .filter((item): item is EvidenceView => item !== null),
    transcriptSummary:
      stringValue(record.transcriptSummary) ??
      (isRecord(record.borrowerSummary)
        ? stringValue(record.borrowerSummary.plainText) ??
          stringValue(record.borrowerSummary.text)
        : null),
    overallRate: percentValue(coverage.overallRate),
    evaluationEligible:
      record.evaluationEligible === true || completionStatus === "COMPLETE",
    evaluationId:
      stringValue(record.evaluationId) ?? stringValue(evaluation?.id),
  };
}

export function adaptInterviewSnapshot(input: unknown): InterviewSnapshotView {
  const record = snapshotRecord(input);
  const session = isRecord(record.session) ? record.session : null;
  if (
    record.snapshotType === "FINAL" ||
    session?.snapshotType === "FINAL" ||
    record.completionStatus === "COMPLETE" ||
    record.completionStatus === "INCOMPLETE"
  ) {
    return adaptFinalSnapshot(record);
  }
  return adaptLiveSnapshot(record);
}

function evaluationRecord(input: unknown): UnknownRecord {
  if (!isRecord(input)) {
    throw new Error("평가 응답 형식을 확인할 수 없습니다.");
  }
  if (isRecord(input.overall) && Array.isArray(input.pillars)) return input;
  if (
    isRecord(input.evaluation) &&
    isRecord(input.evaluation.overall) &&
    Array.isArray(input.evaluation.pillars)
  ) {
    return input.evaluation;
  }
  throw new Error("인터뷰 평가가 응답에 포함되지 않았습니다.");
}

function supportSnapshotRecord(
  input: unknown,
  supportingSnapshot?: unknown,
): UnknownRecord | null {
  if (isRecord(input)) {
    const nested = nestedRecord(input, ["snapshot", "finalSnapshot"]);
    if (nested) return nested;
  }
  return isRecord(supportingSnapshot) ? supportingSnapshot : null;
}

function readDisplayField(record: UnknownRecord | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    const direct = stringValue(value);
    if (direct) return direct;
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Intl.NumberFormat("ko-KR").format(value);
    }
  }
  return null;
}

function optionalGoal(input: UnknownRecord, snapshot: UnknownRecord | null): GoalView | null {
  const goal =
    nestedRecord(input, ["goal", "goalSnapshot"]) ??
    (snapshot ? nestedRecord(snapshot, ["goal", "goalSnapshot"]) : null);
  if (!goal) return null;

  const metricDisplay = (value: unknown): string | null => {
    if (!isRecord(value)) return readDisplayField({ value }, ["value"]);
    const unit = stringValue(value.unit) ?? "";
    return isRecord(value.value)
      ? formatNumericMeasure(value.value, unit)
      : readDisplayField(value, ["value"]);
  };
  const period = isRecord(goal.period)
    ? (() => {
        const value = numberValue(goal.period.value);
        if (value === null) return null;
        const unit = stringValue(goal.period.unit);
        const displayUnit = unit === "MONTH" ? "개월" : unit === "WEEK" ? "주" : unit ?? "";
        return `${new Intl.NumberFormat("ko-KR").format(value)}${displayUnit}`;
      })()
    : readDisplayField(goal, ["period", "targetPeriod", "dueDate"]);
  const measurementSources = asStringArray(goal.measurementSources);
  const behaviorEvent = isRecord(goal.behaviorEvent)
    ? {
        eventName: stringValue(goal.behaviorEvent.eventName),
        window: (() => {
          const raw = stringValue(goal.behaviorEvent.window);
          if (!raw) return null;
          const matched = raw.match(/^\s*(\d+(?:\.\d+)?)\s+(WEEK|MONTH)\s*$/i);
          if (!matched) return raw;
          return `${matched[1]}${matched[2].toUpperCase() === "WEEK" ? "주" : "개월"}`;
        })(),
        metric: stringValue(goal.behaviorEvent.metric),
        aggregation: stringValue(goal.behaviorEvent.aggregation),
        source: stringValue(goal.behaviorEvent.source),
      }
    : null;

  return {
    title: readDisplayField(goal, ["title", "label", "name"]),
    baseline: metricDisplay(goal.baseline ?? goal.currentValue ?? goal.baselineValue),
    target: metricDisplay(goal.target ?? goal.targetValue),
    period,
    unit: stringValue(goal.unit),
    measurementSource:
      measurementSources.join(", ") || readDisplayField(goal, ["measurementSource", "source"]),
    status: stringValue(goal.status),
    numericStatus: stringValue(goal.numericStatus),
    origin: stringValue(goal.origin),
    context: stringValue(goal.context),
    behaviorEvent,
    evidenceIds: asStringArray(goal.evidenceIds),
  };
}

function optionalOfficialCb(
  input: UnknownRecord,
  snapshot: UnknownRecord | null,
): OfficialCbView | null {
  const cb =
    nestedRecord(input, ["officialCb", "cbSnapshot"]) ??
    (snapshot ? nestedRecord(snapshot, ["officialCb", "cbSnapshot"]) : null);
  if (!cb) return null;

  return {
    score: readDisplayField(cb, ["score", "creditScore"]),
    grade: readDisplayField(cb, ["grade", "creditGrade"]),
    source: readDisplayField(cb, ["source", "provider"]),
    observedAt: readDisplayField(cb, ["observedAt", "asOf"]),
  };
}

export function adaptEvaluation(
  input: unknown,
  supportingSnapshot?: unknown,
): EvaluationView {
  const inputRecord = isRecord(input) ? input : {};
  const evaluationData = evaluationRecord(input);
  const overall = isRecord(evaluationData.overall) ? evaluationData.overall : {};
  const pillarRecords = Array.isArray(evaluationData.pillars)
    ? evaluationData.pillars.filter(isRecord)
    : [];
  const support = supportSnapshotRecord(input, supportingSnapshot);
  const borrower = support && isRecord(support.borrower) ? support.borrower : null;
  const business = support && isRecord(support.business) ? support.business : null;
  const evidenceSource = support
    ? Array.isArray(support.evidenceManifest)
      ? support.evidenceManifest
      : Array.isArray(support.evidence)
        ? support.evidence
        : []
    : [];
  const featuresContainer = support && isRecord(support.features) ? support.features : null;
  const features = liveFeatureViews(featuresContainer);
  const transcript = transcriptViews(support?.transcript);
  const transcriptsById = new Map(transcript.map((segment) => [segment.id, segment]));
  const summaryRecord = support && isRecord(support.borrowerSummary)
    ? support.borrowerSummary
    : null;
  const summarySections = summaryRecord && Array.isArray(summaryRecord.sections)
    ? summaryRecord.sections.flatMap((value) => {
        if (!isRecord(value)) return [];
        const text = stringValue(value.text);
        if (!text) return [];
        return [{
          kind: stringValue(value.kind) ?? "SUMMARY",
          text,
          evidenceIds: asStringArray(value.evidenceIds),
          gapStatement: value.gapStatement === true,
        }];
      })
    : [];
  const sourceInformationBase = support
    ? informationItemViews(support.informationItems)
    : [];
  const evaluationItems = Array.isArray(evaluationData.items)
    ? evaluationData.items.filter(isRecord)
    : [];
  const evaluationItemsByCode = new Map(
    evaluationItems.flatMap((item) => {
      const infoCode = stringValue(item.infoCode);
      return infoCode ? [[infoCode, item] as const] : [];
    }),
  );
  const sourceInformation = sourceInformationBase.map((item) => {
    const evaluationItem = evaluationItemsByCode.get(item.infoCode);
    if (!evaluationItem) return item;
    return {
      ...item,
      dataQualityScore: percentValue(evaluationItem.score),
      dataQualityGrade: stringValue(evaluationItem.grade),
      dataQualitySource: stringValue(evaluationItem.source),
      dataQualityAsOf: stringValue(evaluationItem.asOf),
      dataQualitySummary: stringValue(evaluationItem.summary),
    };
  });
  const evaluationRecordData = evaluationData;
  const computedTranscriptSummary = support
    ? stringValue(support.transcriptSummary) ??
      (summarySections.length > 0
        ? summarySections.map((section) => section.text).join(" ")
        : null)
    : null;

  const pillars: EvaluationPillarView[] = CATEGORY_ORDER.map((category) => {
    const pillar =
      pillarRecords.find((item) => stringValue(item.category) === category) ?? null;
    const coverage = pillar && isRecord(pillar.coverage) ? pillar.coverage : null;
    const total =
      numberValue(coverage?.total) ?? numberValue(pillar?.totalRequiredItems);
    const resolved =
      numberValue(coverage?.resolved) ?? numberValue(pillar?.evaluableItems);
    const evaluableRate =
      percentValue(coverage?.evaluableRate) ??
      (total !== null && resolved !== null
        ? percentValue(total === 0 ? 1 : resolved / total)
        : null);
    const level =
      stringValue(pillar?.level) ?? stringValue(pillar?.grade) ?? "UNGRADED";
    return {
      key: category,
      label: stringValue(pillar?.label) ?? CATEGORY_META[category].label,
      shortDescription: CATEGORY_META[category].description,
      confirmationRate:
        percentValue(coverage?.confirmationRate) ??
        (total !== null && resolved !== null
          ? percentValue(total === 0 ? 1 : resolved / total)
          : null),
      evaluableRate,
      total,
      resolved,
      score: percentValue(pillar?.dataSufficiencyScore ?? pillar?.score),
      level,
      levelLabel: LEVEL_LABELS[level] ?? level,
      summary:
        stringValue(pillar?.summary) ?? "서버에서 생성된 영역 요약이 없습니다.",
      contributingFeatureNames: asStringArray(pillar?.featureNames),
      contributingEvidenceIds: asStringArray(pillar?.evidenceIds),
    };
  });

  const legacyUnresolved = Array.isArray(evaluationData.unresolvedItems)
    ? evaluationData.unresolvedItems.flatMap((value) => {
        if (!isRecord(value)) return [];
        const infoCode = stringValue(value.infoCode);
        const status = stringValue(value.status);
        if (!infoCode || !status) return [];
        return [{
          infoCode,
          label: stringValue(value.label) ?? INFO_LABELS[infoCode] ?? infoCode,
          priority: stringValue(value.priority) ?? "P2",
          required: typeof value.required === "boolean" ? value.required : true,
          status,
          statusLabel: STATUS_LABELS[status as InformationStatus] ?? status,
        }];
      })
    : [];
  const unresolvedItems = legacyUnresolved.length > 0
    ? legacyUnresolved
    : sourceInformation
        .filter(
          (item) =>
            item.required && !["CONFIRMED", "NOT_APPLICABLE"].includes(item.status),
        )
        .map((item) => ({
          infoCode: item.infoCode,
          label: item.label,
          priority: item.priority,
          required: item.required,
          status: item.status,
          statusLabel: item.statusLabel,
        }));
  const overallLevel =
    stringValue(overall.level) ?? stringValue(overall.grade) ?? "UNGRADED";

  return {
    id: stringValue(evaluationData.id) ?? "",
    interviewId: stringValue(evaluationData.interviewId) ?? "",
    finalSnapshotId:
      stringValue(evaluationData.finalSnapshotId) ??
      stringValue(evaluationData.snapshotId) ??
      "",
    snapshotVersion:
      numberValue(evaluationData.snapshotVersion) ??
      numberValue(evaluationData.snapshotStateVersion) ??
      0,
    status: stringValue(evaluationData.status) ?? "FAILED",
    disclaimer:
      stringValue(evaluationData.disclaimer) ??
      "이 결과는 대출 승인·거절 또는 신용등급 판단이 아닙니다.",
    createdAt:
      stringValue(evaluationData.createdAt) ??
      stringValue(support?.finalizedAt) ??
      "",
    overallScore: percentValue(overall.dataSufficiencyScore ?? overall.score),
    overallLevel,
    overallLevelLabel: LEVEL_LABELS[overallLevel] ?? overallLevel,
    completionStatus: stringValue(overall.completionStatus) ?? "INCOMPLETE",
    borrowerName: borrower ? stringValue(borrower.name) : null,
    businessName: business ? stringValue(business.businessName) : null,
    industry: business ? stringValue(business.industry) : null,
    transcriptSummary: computedTranscriptSummary,
    pillars,
    unresolvedItems,
    evidence: evidenceSource
      .map((value) => evidenceView(value, transcriptsById))
      .filter((item): item is EvidenceView => item !== null),
    officialCb: optionalOfficialCb(inputRecord, support),
    goal: optionalGoal(inputRecord, support),
    contextAvailable: support !== null,
    decisionScope:
      stringValue(evaluationRecordData.decisionScope) ?? "INTERVIEW_DATA_QUALITY_ONLY",
    gradeScope: stringValue(evaluationRecordData.gradeScope),
    features,
    sourceInformation,
    summarySections,
  };
}

export function adaptEvaluationList(input: unknown): EvaluationListView {
  const record = isRecord(input) ? input : {};
  const source = Array.isArray(input)
    ? input
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.evaluations)
        ? record.evaluations
        : [];
  const items = source.flatMap((value): EvaluationListItemView[] => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.id) ?? stringValue(value.evaluationId);
    if (!id) return [];
    const borrower = isRecord(value.borrower) ? value.borrower : null;
    const business = isRecord(value.business) ? value.business : null;
    const overall = isRecord(value.overall) ? value.overall : null;
    const level =
      stringValue(value.overallLevel) ??
      stringValue(overall?.level) ??
      stringValue(overall?.grade) ??
      "UNGRADED";
    const goals = Array.isArray(value.goals) ? value.goals : null;
    const goalCount =
      numberValue(value.goalCount) ??
      (goals ? goals.length : isRecord(value.goal) ? 1 : 0);

    return [{
      id,
      interviewId: stringValue(value.interviewId) ?? "",
      status: stringValue(value.status) ?? "READY",
      createdAt: stringValue(value.createdAt) ?? stringValue(value.finalizedAt) ?? "",
      completedAt: stringValue(value.completedAt),
      borrowerName:
        stringValue(value.borrowerName) ?? stringValue(borrower?.name),
      businessName:
        stringValue(value.businessName) ?? stringValue(business?.businessName),
      industry: stringValue(value.industry) ?? stringValue(business?.industry),
      overallScore: percentValue(
        value.overallScore ??
        value.dataQualityScore ??
        overall?.dataSufficiencyScore ??
        overall?.score,
      ),
      overallLevel: level,
      overallLevelLabel:
        stringValue(value.overallLevelLabel) ?? LEVEL_LABELS[level] ?? level,
      informationRate: percentValue(
        value.informationRate ??
        value.requiredInformationRate ??
        value.overallRate,
      ),
      goalCount: Math.max(0, Math.trunc(goalCount)),
      completionStatus:
        stringValue(value.completionStatus) ??
        stringValue(overall?.completionStatus) ??
        "INCOMPLETE",
    }];
  });
  const facets = isRecord(record.facets) ? record.facets : null;
  const industries = asStringArray(facets?.industries);
  const levels = asStringArray(facets?.levels);

  return {
    items,
    total: numberValue(record.total) ?? items.length,
    facets: {
      industries:
        industries.length > 0
          ? industries
          : [...new Set(items.flatMap((item) => item.industry ? [item.industry] : []))].sort(),
      levels:
        levels.length > 0
          ? levels
          : [...new Set(items.map((item) => item.overallLevel))].sort(),
    },
  };
}

export async function readApiEnvelope(response: Response): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);
  const record = isRecord(payload) ? payload : null;
  const errorValue = record?.error;

  if (!response.ok || (errorValue !== null && errorValue !== undefined)) {
    const errorRecord = isRecord(errorValue) ? errorValue : null;
    const details = errorRecord && isRecord(errorRecord.details) ? errorRecord.details : null;
    const message =
      stringValue(errorRecord?.message) ??
      stringValue(errorValue) ??
      stringValue(record?.message) ??
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    const blockers = [
      ...asStringArray(errorRecord?.blockers),
      ...asStringArray(details?.blockers),
      ...asStringArray(details?.unresolvedItems),
      ...asStringArray(record?.blockers),
    ];
    throw new ApiRequestError(
      message,
      Array.from(new Set(blockers)),
      stringValue(errorRecord?.code),
      response.status,
    );
  }

  if (record && Object.prototype.hasOwnProperty.call(record, "data")) {
    return record.data;
  }
  return payload;
}

/**
 * Local development uses an explicit workspace bootstrap endpoint. Production
 * deployments return 401 from that endpoint and should route the operator to
 * the normal session login screen.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const requestInit: RequestInit = { ...init, credentials: "include" };
  let response = await fetch(input, requestInit);
  if (response.status !== 401 || String(input).includes("/api/auth/")) {
    return response;
  }

  const bootstrap = await fetch("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "include",
  });
  if (!bootstrap.ok) return response;
  response = await fetch(input, requestInit);
  return response;
}

export function createClientCommandId(prefix = "web"): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

export function extractInterviewId(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const session = isRecord(input.session) ? input.session : null;
  const snapshot = isRecord(input.snapshot) ? input.snapshot : null;
  const snapshotSession = snapshot && isRecord(snapshot.session) ? snapshot.session : null;

  return (
    stringValue(session?.id) ??
    stringValue(input.interviewId) ??
    stringValue(input.id) ??
    stringValue(snapshotSession?.id) ??
    stringValue(snapshot?.interviewId)
  );
}

export function extractEvaluationId(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const evaluation = isRecord(input.evaluation) ? input.evaluation : null;
  return (
    stringValue(evaluation?.id) ??
    stringValue(input.evaluationId) ??
    (isRecord(input.snapshot) ? stringValue(input.snapshot.evaluationId) : null)
  );
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export interface ScorecardItemView {
  name: string;
  points: number | null;
  excluded: boolean;
  band: string;
  note: string | null;
}

export interface ScorecardAxisView {
  score: number | null;
  scoreLabel: string;
  items: ScorecardItemView[];
  itemsUsed: number;
  itemsTotal: number;
  basis: string;
  note: string | null;
}

export interface ModelingScorecardView {
  status: "READY" | "UNAVAILABLE";
  unavailableMessage: string | null;
  currentSituation: ScorecardAxisView | null;
  improvement: ScorecardAxisView | null;
  reproduceCommand: string | null;
  transactionDataSource: string | null;
}

function scorecardItemViews(value: unknown): ScorecardItemView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    name: stringValue(item.name) ?? "이름 없음",
    points: numberValue(item.points),
    excluded: item.excluded === true,
    band: stringValue(item.band) ?? "—",
    note: stringValue(item.note),
  }));
}

function scorecardAxisView(value: unknown): ScorecardAxisView | null {
  if (!isRecord(value)) return null;
  const score = numberValue(value.score);
  return {
    score,
    // 점수 자리에 상태 문자열이 오면 숫자로 바꾸지 않고 그대로 보여 준다.
    scoreLabel: score === null ? (stringValue(value.score) ?? "산출 불가") : `${score}`,
    items: scorecardItemViews(value.items),
    itemsUsed: numberValue(value.items_used) ?? 0,
    itemsTotal: numberValue(value.items_total) ?? 0,
    basis: stringValue(value.basis) ?? "",
    note: stringValue(value.note),
  };
}

export function adaptModelingScorecard(input: unknown): ModelingScorecardView {
  const record = isRecord(input) ? input : {};
  const data = isRecord(record.data) ? record.data : record;
  const scorecard = isRecord(data.scorecard) ? data.scorecard : null;
  return {
    status: data.status === "READY" ? "READY" : "UNAVAILABLE",
    unavailableMessage: stringValue(data.unavailableMessage),
    currentSituation: scorecard ? scorecardAxisView(scorecard.current_situation) : null,
    improvement: scorecard ? scorecardAxisView(scorecard.improvement) : null,
    reproduceCommand: stringValue(data.reproduceCommand),
    transactionDataSource: stringValue(data.transactionDataSource),
  };
}
