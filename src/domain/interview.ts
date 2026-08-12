export const INFORMATION_STATUSES = [
  "NEEDED",
  "ASKING",
  "COLLECTED",
  "CONFIRMED",
  "NEEDS_FOLLOWUP",
  "CONFLICT",
  "UNAVAILABLE",
  "REFUSED",
  "NOT_APPLICABLE",
] as const;

export type InformationStatus = (typeof INFORMATION_STATUSES)[number];

export const VALUE_STATES = [
  "PRESENT",
  "MISSING",
  "UNKNOWN",
  "REFUSED",
  "NOT_APPLICABLE",
] as const;

export type ValueState = (typeof VALUE_STATES)[number];

export const INFORMATION_CATEGORIES = [
  "CURRENT_STATE",
  "IMPROVEMENT_INTENT",
  "FUTURE_OUTLOOK",
  "HOUSEHOLD_STATE",
] as const;

export type InformationCategory = (typeof INFORMATION_CATEGORIES)[number];

export type InformationPriority = "P0" | "P1" | "P2";

export type ExpectedInformationType =
  | "AMOUNT"
  | "RATIO"
  | "INTEGER"
  | "TEXT"
  | "BOOLEAN"
  | "DATE"
  | "DURATION"
  | "RANGE";

export type InformationQuality = "LOW" | "MEDIUM" | "HIGH";

export type EvidenceKind =
  | "SELF_REPORTED"
  | "DOCUMENT_SUPPORTED"
  | "TRANSACTION_SUPPORTED"
  | "SYSTEM_DERIVED"
  | "CONFLICTING"
  | "UNKNOWN";

export type SnapshotType = "PREVIEW" | "FINAL";

export interface RequiredInformationItem {
  infoCode: string;
  label: string;
  category: InformationCategory;
  priority: InformationPriority;
  expectedType: ExpectedInformationType;
  required: boolean;
  minQuality: InformationQuality;
  evidencePreference: EvidenceKind[];
  dependencies: string[];
  status: InformationStatus;
  question: string;
  followupQuestion?: string;
}

export interface MoneyValue {
  amount: number;
  currency: "KRW";
  period: "MONTH" | "ONE_TIME";
}

export type InformationValueData =
  | MoneyValue
  | number
  | string
  | boolean
  | { min?: number; max?: number; unit: string };

export interface PrefillValue {
  value: InformationValueData;
  source: string;
  observedAt: string;
  evidenceId: string;
}

export interface InformationItem extends RequiredInformationItem {
  valueState: ValueState;
  value: InformationValueData | null;
  quality: InformationQuality | null;
  extractionConfidence: number | null;
  verification: EvidenceKind | null;
  evidenceIds: string[];
  prefill: PrefillValue | null;
  updatedAt: string;
}

export interface Borrower {
  id: string;
  name: string;
}

export interface BusinessProfile {
  id: string;
  borrowerId: string;
  businessName: string;
  industry: string;
}

export interface TranscriptSegment {
  id: string;
  interviewId: string;
  sequence: number;
  speaker: "ASSISTANT" | "BORROWER";
  text: string;
  confirmation: "FINAL";
  createdAt: string;
}

export interface EvidenceRef {
  id: string;
  interviewId: string;
  infoCode: string;
  kind: EvidenceKind;
  source: string;
  transcriptSegmentId: string | null;
  excerpt: string | null;
  observedAt: string;
  metadata: Record<string, unknown>;
}

export interface InformationStatusEvent {
  id: string;
  interviewId: string;
  infoCode: string;
  sequence: number;
  eventType:
    | "STATUS_CHANGED"
    | "STATUS_CHANGE_REJECTED"
    | "VALUE_CHANGED"
    | "CORRECTION";
  fromStatus: InformationStatus;
  toStatus: InformationStatus;
  accepted: boolean;
  reason: string;
  createdAt: string;
}

export interface CategoryCoverage {
  total: number;
  resolved: number;
  evaluable: number;
  confirmationRate: number;
  evaluableRate: number;
}

export interface Coverage {
  snapshotType: SnapshotType;
  totalRequired: number;
  resolvedRequired: number;
  evaluableRequired: number;
  statusConfirmationRate: number;
  evaluableValueRate: number;
  requiredInformationRate: number;
  overallRate: number;
  unresolvedP0: number;
  byCategory: Record<InformationCategory, CategoryCoverage>;
}

export interface NextQuestion {
  infoCode: string;
  text: string;
  reason: "INITIAL" | "PRIORITY" | "FOLLOWUP" | "CONFLICT";
}

export interface InterviewSessionSummary {
  id: string;
  lifecycleStatus: "ACTIVE" | "COMPLETE" | "INCOMPLETE";
  snapshotType: SnapshotType;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface LiveInterviewSnapshot {
  session: InterviewSessionSummary & { snapshotType: "PREVIEW" };
  borrower: Borrower;
  business: BusinessProfile;
  informationItems: InformationItem[];
  transcript: TranscriptSegment[];
  evidence: EvidenceRef[];
  coverage: Coverage & { snapshotType: "PREVIEW" };
  nextQuestion: NextQuestion | null;
}

export interface FinalInterviewSnapshot {
  id: string;
  interviewId: string;
  snapshotType: "FINAL";
  version: number;
  finalizedAt: string;
  completionStatus: "COMPLETE" | "INCOMPLETE";
  borrower: Borrower;
  business: BusinessProfile;
  informationItems: InformationItem[];
  transcript: TranscriptSegment[];
  evidenceManifest: EvidenceRef[];
  coverage: Coverage & { snapshotType: "FINAL" };
  transcriptSummary: string;
}

export interface EvaluationPillar {
  category: InformationCategory;
  label: string;
  dataSufficiencyScore: number;
  level: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";
  coverage: CategoryCoverage;
  summary: string;
}

export interface InterviewEvaluation {
  id: string;
  interviewId: string;
  finalSnapshotId: string;
  snapshotVersion: number;
  status: "PENDING" | "GENERATING" | "READY" | "FAILED";
  decisionScope: "DATA_SUFFICIENCY_ONLY";
  approvalDecision: null;
  disclaimer: string;
  overall: {
    dataSufficiencyScore: number;
    level: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";
    completionStatus: "COMPLETE" | "INCOMPLETE";
  };
  pillars: EvaluationPillar[];
  unresolvedItems: Array<{
    infoCode: string;
    label: string;
    priority: InformationPriority;
    status: InformationStatus;
  }>;
  createdAt: string;
}

export interface TurnPlannerProcessingMetadata {
  provider: string;
  model: string;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
}

export interface MessageProcessingResult {
  snapshot: LiveInterviewSnapshot;
  stateChanges: InformationStatusEvent[];
  evidenceAdded: EvidenceRef[];
  acceptedTranscript: TranscriptSegment;
  processing: {
    status: "APPLIED" | "RETRYABLE_FAILURE" | "NON_RETRYABLE_FAILURE";
    code: string | null;
    metadata?: TurnPlannerProcessingMetadata;
  };
}

export interface CompletionResult {
  snapshot: FinalInterviewSnapshot;
  evaluation: InterviewEvaluation;
}
