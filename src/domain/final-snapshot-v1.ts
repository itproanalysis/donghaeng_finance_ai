import type { CompletionAssessment } from "./completion-policy";
import type { LiveFeatureSet } from "./feature-engine";
import type { GoalSnapshot } from "./goals";
import type {
  Borrower,
  BusinessProfile,
  EvidenceRef,
  TranscriptSegment,
} from "./interview";
import type { CanonicalInformationRecord } from "./information-values";
import type { EvidenceLinkedSummary } from "./live-summary";

export const IMMUTABLE_FINAL_SCHEMA_VERSION = "dev-v1" as const;

export interface ImmutableFinalInterviewSnapshotV1 {
  id: string;
  interviewId: string;
  snapshotType: "FINAL";
  schemaVersion: typeof IMMUTABLE_FINAL_SCHEMA_VERSION;
  stateVersion: number;
  finalizedAt: string;
  completionStatus: "COMPLETE" | "INCOMPLETE";
  completionAssessment: CompletionAssessment;
  borrower: Borrower;
  business: BusinessProfile;
  informationItems: CanonicalInformationRecord[];
  features: LiveFeatureSet & { snapshotType: "FINAL" };
  goalSnapshot: GoalSnapshot;
  borrowerSummary: EvidenceLinkedSummary & { snapshotType: "FINAL" };
  transcript: TranscriptSegment[];
  evidenceManifest: EvidenceRef[];
  versions: {
    valueSchema: "dev-v1";
    parser: "dev-v1";
    featureRegistry: "dev-v1";
    goalPolicy: "dev-v1";
    completionPolicy: "dev-v1";
    evaluationPolicy: "dev-v1";
  };
  contentHash: string;
}

export interface FinalSnapshotValidationIssue {
  code: string;
  path: string;
  message: string;
}

export function validateImmutableFinalSnapshotV1(
  snapshot: ImmutableFinalInterviewSnapshotV1,
): FinalSnapshotValidationIssue[] {
  const issues: FinalSnapshotValidationIssue[] = [];
  if (snapshot.snapshotType !== "FINAL") {
    issues.push({ code: "NOT_FINAL", path: "snapshotType", message: "immutable snapshot은 FINAL이어야 합니다." });
  }
  if (snapshot.features.snapshotType !== "FINAL" || snapshot.borrowerSummary.snapshotType !== "FINAL") {
    issues.push({ code: "NESTED_PREVIEW_DATA", path: "features|borrowerSummary", message: "FINAL 안에 PREVIEW 데이터를 포함할 수 없습니다." });
  }
  if (!snapshot.contentHash.trim()) {
    issues.push({ code: "MISSING_CONTENT_HASH", path: "contentHash", message: "canonical JSON content hash가 필요합니다." });
  }
  const evidenceIds = new Set(snapshot.evidenceManifest.map((evidence) => evidence.id));
  for (const record of snapshot.informationItems) {
    for (const revision of record.revisions) {
      for (const evidenceId of revision.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          issues.push({ code: "BROKEN_EVIDENCE_REF", path: `informationItems.${record.infoCode}`, message: `evidence를 찾을 수 없습니다: ${evidenceId}` });
        }
      }
    }
  }
  for (const feature of snapshot.features.features) {
    for (const evidenceId of feature.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({ code: "BROKEN_EVIDENCE_REF", path: `features.${feature.name}`, message: `evidence를 찾을 수 없습니다: ${evidenceId}` });
      }
    }
  }
  for (const section of snapshot.borrowerSummary.sections) {
    if (!section.gapStatement && section.evidenceIds.length === 0) {
      issues.push({ code: "UNCITED_SUMMARY", path: `borrowerSummary.${section.kind}`, message: "요약 문장에는 evidence reference가 필요합니다." });
    }
    for (const evidenceId of section.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({ code: "BROKEN_EVIDENCE_REF", path: `borrowerSummary.${section.kind}`, message: `evidence를 찾을 수 없습니다: ${evidenceId}` });
      }
    }
  }
  for (const evidenceId of snapshot.goalSnapshot.evidenceIds) {
    if (!evidenceIds.has(evidenceId)) {
      issues.push({ code: "BROKEN_EVIDENCE_REF", path: "goalSnapshot", message: `evidence를 찾을 수 없습니다: ${evidenceId}` });
    }
  }
  if (snapshot.completionStatus === "COMPLETE" && !snapshot.completionAssessment.evaluationEligible) {
    issues.push({ code: "INELIGIBLE_COMPLETE", path: "completionAssessment", message: "COMPLETE snapshot은 평가 eligibility를 충족해야 합니다." });
  }
  if (snapshot.completionStatus === "INCOMPLETE" && snapshot.completionAssessment.evaluationEligible) {
    issues.push({ code: "INCOMPLETE_MARKED_ELIGIBLE", path: "completionAssessment", message: "INCOMPLETE snapshot은 공식 보조평가 대상이 아닙니다." });
  }
  return issues;
}
