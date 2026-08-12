import {
  DEV_V1_FEATURE_REGISTRY,
  type FeatureDefinition,
} from "./feature-registry";
import type { FeatureComputationState, LiveFeatureSet } from "./feature-engine";
import type { GoalSnapshot } from "./goals";
import type { InformationQuality, InformationStatus } from "./interview";
import {
  type CanonicalInformationRecord,
  selectedRevision,
} from "./information-values";

export const DEV_V1_COMPLETION_POLICY_VERSION = "dev-v1" as const;

export type CompletionMode = "STRICT" | "FORCE_INCOMPLETE";

export type CompletionBlockerCode =
  | "CATALOG_INVALID"
  | "ACTIVE_TURN"
  | "FINAL_TRANSCRIPT_PENDING"
  | "UNRESOLVED_REQUIRED_STATUS"
  | "REQUIRED_VALUE_NOT_EVALUABLE"
  | "BELOW_MIN_QUALITY"
  | "UNRESOLVED_REQUIRED_CONFLICT"
  | "REQUIRED_FEATURE_NOT_COMPUTABLE"
  | "GOAL_STATUS_UNRESOLVED"
  | "GOAL_TARGET_STATUS_UNRESOLVED"
  | "BORROWER_CONFIRMATION_MISSING"
  | "EVIDENCE_INTEGRITY_FAILED"
  | "FORCE_REASON_REQUIRED";

export interface CompletionBlocker {
  code: CompletionBlockerCode;
  entityCode: string | null;
  message: string;
}

export interface BorrowerFinalConfirmation {
  status: "PENDING" | "CONFIRMED" | "DECLINED";
  confirmedAt: string | null;
  transcriptSegmentId: string | null;
  evidenceId: string | null;
}

export interface CompletionPolicyInput {
  mode: CompletionMode;
  records: readonly CanonicalInformationRecord[];
  featureSet: LiveFeatureSet;
  goal: GoalSnapshot;
  borrowerConfirmation: BorrowerFinalConfirmation;
  knownEvidenceIds: ReadonlySet<string>;
  catalogValid: boolean;
  activeTurn: boolean;
  finalTranscriptPending: boolean;
  unresolvedConflictInfoCodes: readonly string[];
  forceReason?: string | null;
}

export interface CompletionAssessment {
  policyVersion: typeof DEV_V1_COMPLETION_POLICY_VERSION;
  mode: CompletionMode;
  readyForStrictCompletion: boolean;
  canFinalize: boolean;
  completionStatus: "COMPLETE" | "INCOMPLETE" | null;
  evaluationEligible: boolean;
  blockers: CompletionBlocker[];
}

const QUALITY_RANK: Record<InformationQuality, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const RESOLVED_STATUSES = new Set<InformationStatus>([
  "CONFIRMED",
  "UNAVAILABLE",
  "REFUSED",
  "NOT_APPLICABLE",
]);

const ACCEPTABLE_REQUIRED_FEATURE_STATES = new Set<FeatureComputationState>([
  "COMPUTED",
  "NOT_APPLICABLE",
]);

function add(
  blockers: CompletionBlocker[],
  code: CompletionBlockerCode,
  message: string,
  entityCode: string | null = null,
): void {
  if (!blockers.some((blocker) => blocker.code === code && blocker.entityCode === entityCode)) {
    blockers.push({ code, entityCode, message });
  }
}

function requiredFeatureDefinitions(): FeatureDefinition[] {
  return DEV_V1_FEATURE_REGISTRY.filter((definition) => definition.requiredForCompletion);
}

export function assessInterviewCompletion(
  input: CompletionPolicyInput,
): CompletionAssessment {
  const blockers: CompletionBlocker[] = [];
  if (!input.catalogValid) add(blockers, "CATALOG_INVALID", "dev-v1 필요정보 catalog validation이 실패했습니다.");
  if (input.activeTurn) add(blockers, "ACTIVE_TURN", "처리 중인 발화가 있습니다.");
  if (input.finalTranscriptPending) add(blockers, "FINAL_TRANSCRIPT_PENDING", "확정되지 않은 transcript가 있습니다.");

  for (const record of input.records.filter((candidate) => candidate.required)) {
    if (!RESOLVED_STATUSES.has(record.status)) {
      add(blockers, "UNRESOLVED_REQUIRED_STATUS", "필수 정보 상태가 확정되지 않았습니다.", record.infoCode);
      continue;
    }
    if (record.status !== "CONFIRMED" && record.status !== "NOT_APPLICABLE") {
      add(blockers, "REQUIRED_VALUE_NOT_EVALUABLE", "필수 정보가 평가 가능한 값으로 확인되지 않았습니다.", record.infoCode);
      continue;
    }
    if (record.status === "NOT_APPLICABLE") continue;
    const revision = selectedRevision(record);
    if (!revision?.value || revision.valueState !== "PRESENT") {
      add(blockers, "REQUIRED_VALUE_NOT_EVALUABLE", "선택된 canonical value revision이 없습니다.", record.infoCode);
      continue;
    }
    if (!revision.quality || QUALITY_RANK[revision.quality] < QUALITY_RANK[record.minQuality]) {
      add(blockers, "BELOW_MIN_QUALITY", `필수 정보가 최소 품질 ${record.minQuality}에 미달합니다.`, record.infoCode);
    }
    if (revision.evidenceIds.length === 0 || revision.evidenceIds.some((id) => !input.knownEvidenceIds.has(id))) {
      add(blockers, "EVIDENCE_INTEGRITY_FAILED", "선택 revision의 evidence reference가 없거나 손상되었습니다.", record.infoCode);
    }
  }

  for (const infoCode of input.unresolvedConflictInfoCodes) {
    const record = input.records.find((candidate) => candidate.infoCode === infoCode);
    if (record?.required || record?.priority === "P0") {
      add(blockers, "UNRESOLVED_REQUIRED_CONFLICT", "dev-v1은 필수/P0 conflict 허용치가 0입니다.", infoCode);
    }
  }

  for (const definition of requiredFeatureDefinitions()) {
    const feature = input.featureSet.features.find((candidate) => candidate.name === definition.name);
    if (!feature || !ACCEPTABLE_REQUIRED_FEATURE_STATES.has(feature.state)) {
      add(blockers, "REQUIRED_FEATURE_NOT_COMPUTABLE", "필수 feature를 계산할 수 없습니다.", definition.name);
    }
  }

  if (!["CONFIRMED", "NO_GOAL_STATED", "REFUSED", "UNAVAILABLE"].includes(input.goal.status)) {
    add(blockers, "GOAL_STATUS_UNRESOLVED", "목표 상태가 명시적으로 확정되지 않았습니다.");
  }
  if (input.goal.status === "CONFIRMED" && !["DIRECT", "AGREED"].includes(input.goal.numericStatus)) {
    add(blockers, "GOAL_TARGET_STATUS_UNRESOLVED", "확정 목표의 baseline·target·기간·source가 미확정입니다.");
  }
  if (input.borrowerConfirmation.status !== "CONFIRMED" || !input.borrowerConfirmation.evidenceId) {
    add(blockers, "BORROWER_CONFIRMATION_MISSING", "차주의 최종 요약 확인 evidence가 필요합니다.");
  } else if (!input.knownEvidenceIds.has(input.borrowerConfirmation.evidenceId)) {
    add(blockers, "EVIDENCE_INTEGRITY_FAILED", "차주 최종 확인 evidence reference가 손상되었습니다.");
  }

  const strictBlockers = blockers.length;
  const readyForStrictCompletion = strictBlockers === 0;
  if (input.mode === "FORCE_INCOMPLETE" && !input.forceReason?.trim()) {
    add(blockers, "FORCE_REASON_REQUIRED", "강제중단 사유를 명시해야 합니다.");
  }
  const realtimePersistencePending = blockers.some((blocker) =>
    blocker.code === "ACTIVE_TURN" || blocker.code === "FINAL_TRANSCRIPT_PENDING",
  );
  const canFinalize =
    input.mode === "STRICT"
      ? readyForStrictCompletion
      : Boolean(input.forceReason?.trim()) && !realtimePersistencePending;
  return {
    policyVersion: DEV_V1_COMPLETION_POLICY_VERSION,
    mode: input.mode,
    readyForStrictCompletion,
    canFinalize,
    completionStatus: canFinalize
      ? input.mode === "STRICT"
        ? "COMPLETE"
        : "INCOMPLETE"
      : null,
    evaluationEligible: input.mode === "STRICT" && readyForStrictCompletion,
    blockers,
  };
}
