import {
  DEV_V1_FEATURE_REGISTRY,
  type FeatureDefinition,
} from "./feature-registry";
import type { ImmutableFinalInterviewSnapshotV1 } from "./final-snapshot-v1";
import type {
  EvidenceKind,
  InformationCategory,
  InformationQuality,
  InformationStatus,
  ValueState,
} from "./interview";
import { selectedRevision } from "./information-values";
import { validateImmutableFinalSnapshotV1 } from "./final-snapshot-v1";

export const DEV_V1_EVALUATION_POLICY_VERSION = "dev-v1" as const;
export const DEV_V1_DATA_QUALITY_GRADE_THRESHOLDS = {
  A: 90,
  B: 80,
  C: 70,
  D: 60,
  E: 0,
} as const;

export type InterviewDataQualityGrade = "A" | "B" | "C" | "D" | "E" | "UNGRADED";

export const DEV_V1_DATA_QUALITY_ITEM_SCORE_WEIGHTS = {
  extractionConfidence: 0.5,
  informationQuality: 0.35,
  evidenceStrength: 0.15,
} as const;

export interface DataQualityItemEvaluation {
  infoCode: string;
  category: InformationCategory;
  required: boolean;
  status: InformationStatus;
  valueState: ValueState;
  evaluable: boolean;
  score: number | null;
  grade: InterviewDataQualityGrade;
  parserConfidence: number | null;
  informationQuality: InformationQuality | null;
  verification: EvidenceKind | null;
  source: string | null;
  asOf: string | null;
  evidenceIds: string[];
  summary: string;
}

export interface DataQualityPillarEvaluation {
  category: InformationCategory;
  score: number;
  grade: InterviewDataQualityGrade;
  evaluableItems: number;
  totalRequiredItems: number;
  computedFeatures: number;
  totalRequiredFeatures: number;
  quality: {
    high: number;
    medium: number;
    low: number;
  };
  summary: string;
  featureNames: string[];
  evidenceIds: string[];
}

export interface InterviewDataQualityEvaluationV1 {
  policyVersion: typeof DEV_V1_EVALUATION_POLICY_VERSION;
  snapshotId: string;
  snapshotStateVersion: number;
  status: "READY" | "NOT_ELIGIBLE" | "FAILED";
  decisionScope: "INTERVIEW_DATA_QUALITY_ONLY";
  gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1";
  approvalDecision: null;
  creditGrade: null;
  overall: {
    score: number;
    grade: InterviewDataQualityGrade;
    completionStatus: "COMPLETE" | "INCOMPLETE";
  };
  pillars: DataQualityPillarEvaluation[];
  items: DataQualityItemEvaluation[];
  qualitySummary: string;
  disclaimer: string;
  failureReasons: string[];
}

const QUALITY_RANK: Record<InformationQuality, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const QUALITY_SCORE: Record<InformationQuality, number> = {
  LOW: 0.5,
  MEDIUM: 0.75,
  HIGH: 1,
};
const EVIDENCE_SCORE = {
  SELF_REPORTED: 0.5,
  DOCUMENT_SUPPORTED: 0.85,
  TRANSACTION_SUPPORTED: 1,
  SYSTEM_DERIVED: 0.8,
  CONFLICTING: 0,
  UNKNOWN: 0,
} as const;
const SCORE_WEIGHTS = {
  requiredCoverage: 0.4,
  extractionConfidence: 0.35,
  informationQuality: 0.2,
  evidenceStrength: 0.05,
} as const;
const CATEGORIES: InformationCategory[] = [
  "CURRENT_STATE",
  "IMPROVEMENT_INTENT",
  "FUTURE_OUTLOOK",
  "HOUSEHOLD_STATE",
];

function gradeFor(score: number, eligible: boolean): InterviewDataQualityGrade {
  if (!eligible) return "UNGRADED";
  if (score >= DEV_V1_DATA_QUALITY_GRADE_THRESHOLDS.A) return "A";
  if (score >= DEV_V1_DATA_QUALITY_GRADE_THRESHOLDS.B) return "B";
  if (score >= DEV_V1_DATA_QUALITY_GRADE_THRESHOLDS.C) return "C";
  if (score >= DEV_V1_DATA_QUALITY_GRADE_THRESHOLDS.D) return "D";
  return "E";
}

function requiredFeatures(category: InformationCategory): FeatureDefinition[] {
  return DEV_V1_FEATURE_REGISTRY.filter(
    (feature) => feature.domain === category && feature.requiredForCompletion,
  );
}

function average(values: readonly number[], whenEmpty: number): number {
  if (values.length === 0) return whenEmpty;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function boundedConfidence(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isEvaluableRecord(
  record: ImmutableFinalInterviewSnapshotV1["informationItems"][number],
): boolean {
  if (record.status === "NOT_APPLICABLE") return true;
  if (record.status !== "CONFIRMED") return false;
  const revision = selectedRevision(record);
  return Boolean(
    revision?.value &&
      revision.quality &&
      QUALITY_RANK[revision.quality] >= QUALITY_RANK[record.minQuality] &&
      revision.evidenceIds.length > 0,
  );
}

function itemEvaluation(
  snapshot: ImmutableFinalInterviewSnapshotV1,
  record: ImmutableFinalInterviewSnapshotV1["informationItems"][number],
  eligible: boolean,
): DataQualityItemEvaluation {
  const revision = selectedRevision(record);
  const evaluable = isEvaluableRecord(record);
  const evidenceIds = revision?.evidenceIds ?? [];
  const evidenceById = new Map(
    snapshot.evidenceManifest.map((evidence) => [evidence.id, evidence] as const),
  );
  const evidence = evidenceIds.flatMap((id) => {
    const match = evidenceById.get(id);
    return match ? [match] : [];
  });
  const sources = [...new Set(evidence.map((item) => item.source).filter(Boolean))];
  const asOf = [...evidence.map((item) => item.observedAt).filter(Boolean)].sort().at(-1) ??
    revision?.observedAt ??
    null;
  const canScore = eligible && evaluable && revision !== null;
  const score = canScore
    ? Math.round(
        (
          boundedConfidence(revision.parserConfidence) *
            DEV_V1_DATA_QUALITY_ITEM_SCORE_WEIGHTS.extractionConfidence +
          (revision.quality ? QUALITY_SCORE[revision.quality] : 0) *
            DEV_V1_DATA_QUALITY_ITEM_SCORE_WEIGHTS.informationQuality +
          (evidenceIds.length > 0 ? EVIDENCE_SCORE[revision.verification] : 0) *
            DEV_V1_DATA_QUALITY_ITEM_SCORE_WEIGHTS.evidenceStrength
        ) * 100,
      )
    : null;

  let summary: string;
  if (!eligible) {
    summary = "FINAL 인터뷰가 평가 대상이 아니므로 항목 데이터 품질 등급을 산출하지 않았습니다.";
  } else if (record.status === "NOT_APPLICABLE") {
    summary = "차주 확인으로 해당 없음 처리된 항목이며 데이터 품질 점수에서 제외했습니다.";
  } else if (!canScore) {
    summary = "선택된 값·최소 품질·근거가 모두 확인되지 않아 항목 데이터 품질 등급을 산출하지 않았습니다.";
  } else {
    const confPct = Math.round(boundedConfidence(revision.parserConfidence) * 100);
    const ver = revision.verification;
    const qual = revision.quality ?? "미확인";
    const verificationNote =
      ver === "SELF_REPORTED"
        ? " (차주 구두 진술)"
        : ver === "DOCUMENT_SUPPORTED"
          ? " (서류 증빙)"
          : ver === "TRANSACTION_SUPPORTED"
            ? " (거래 내역 증빙)"
            : "";
    summary = `추출 신뢰도 ${confPct}%, 정보 품질 ${qual}, 근거 유형 ${ver}${verificationNote}을(를) 종합 반영한 데이터 품질 점수(${score}점)입니다.`;
  }

  return {
    infoCode: record.infoCode,
    category: record.category,
    required: record.required,
    status: record.status,
    valueState: record.valueState,
    evaluable,
    score,
    grade: score === null ? "UNGRADED" : gradeFor(score, true),
    parserConfidence: revision?.parserConfidence ?? null,
    informationQuality: revision?.quality ?? null,
    verification: revision?.verification ?? null,
    source: sources.length > 0 ? sources.join(", ") : null,
    asOf,
    evidenceIds: [...evidenceIds],
    summary,
  };
}

export function buildInterviewDataQualityEvaluationV1(
  snapshot: ImmutableFinalInterviewSnapshotV1,
): InterviewDataQualityEvaluationV1 {
  const validationIssues = validateImmutableFinalSnapshotV1(snapshot);
  const eligible =
    snapshot.completionStatus === "COMPLETE" &&
    snapshot.completionAssessment.evaluationEligible &&
    validationIssues.length === 0;

  const items = snapshot.informationItems.map((record) =>
    itemEvaluation(snapshot, record, eligible),
  );

  const pillars = CATEGORIES.map((category): DataQualityPillarEvaluation => {
    const records = snapshot.informationItems.filter(
      (record) => record.required && record.category === category,
    );
    const evaluable = records.filter(isEvaluableRecord);
    const featureDefinitions = requiredFeatures(category);
    const features = snapshot.features.features.filter((feature) =>
      featureDefinitions.some((definition) => definition.name === feature.name),
    );
    const computedFeatures = features.filter((feature) =>
      ["COMPUTED", "NOT_APPLICABLE"].includes(feature.state),
    );
    const itemRate = records.length === 0 ? 1 : evaluable.length / records.length;
    const featureRate = featureDefinitions.length === 0
      ? 1
      : computedFeatures.length / featureDefinitions.length;
    const revisions = evaluable
      .map((record) => selectedRevision(record))
      .filter((revision): revision is NonNullable<typeof revision> => revision !== null);
    const terminalDispositionCount = evaluable.length - revisions.length;
    const confidenceRate = average(
      [
        ...revisions.map((revision) => boundedConfidence(revision.parserConfidence)),
        ...Array.from({ length: terminalDispositionCount }, () => 1),
      ],
      records.length === 0 ? 1 : 0,
    );
    const qualityRate = average(
      [
        ...revisions.map((revision) => revision.quality ? QUALITY_SCORE[revision.quality] : 0),
        ...Array.from({ length: terminalDispositionCount }, () => 1),
      ],
      records.length === 0 ? 1 : 0,
    );
    const evidenceRate = average(
      [
        ...revisions.map((revision) =>
          revision.evidenceIds.length > 0 ? EVIDENCE_SCORE[revision.verification] : 0,
        ),
        ...Array.from({ length: terminalDispositionCount }, () => 1),
      ],
      records.length === 0 ? 1 : 0,
    );
    const requiredCoverageRate = (itemRate + featureRate) / 2;
    const score = Math.round(
      (
        requiredCoverageRate * SCORE_WEIGHTS.requiredCoverage +
        confidenceRate * SCORE_WEIGHTS.extractionConfidence +
        qualityRate * SCORE_WEIGHTS.informationQuality +
        evidenceRate * SCORE_WEIGHTS.evidenceStrength
      ) * 100,
    );
    const quality = {
      high: revisions.filter((revision) => revision.quality === "HIGH").length,
      medium: revisions.filter((revision) => revision.quality === "MEDIUM").length,
      low: revisions.filter((revision) => revision.quality === "LOW").length,
    };
    return {
      category,
      score,
      grade: gradeFor(score, eligible),
      evaluableItems: evaluable.length,
      totalRequiredItems: records.length,
      computedFeatures: computedFeatures.length,
      totalRequiredFeatures: featureDefinitions.length,
      quality,
      summary: `${category} 필수정보 ${evaluable.length}/${records.length}건, 필수 feature ${computedFeatures.length}/${featureDefinitions.length}건의 충족도와 추출 신뢰도·정보 품질·근거 유형을 평가했습니다.`,
      featureNames: features.map((feature) => feature.name),
      evidenceIds: [...new Set([
        ...revisions.flatMap((revision) => revision.evidenceIds),
        ...features.flatMap((feature) => feature.evidenceIds),
      ])],
    };
  });

  const overallScore = Math.round(
    pillars.reduce((sum, pillar) => sum + pillar.score, 0) / pillars.length,
  );
  const status: InterviewDataQualityEvaluationV1["status"] = validationIssues.length > 0
    ? "FAILED"
    : eligible
      ? "READY"
      : "NOT_ELIGIBLE";
  return {
    policyVersion: DEV_V1_EVALUATION_POLICY_VERSION,
    snapshotId: snapshot.id,
    snapshotStateVersion: snapshot.stateVersion,
    status,
    decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
    gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
    approvalDecision: null,
    creditGrade: null,
    overall: {
      score: overallScore,
      grade: gradeFor(overallScore, eligible),
      completionStatus: snapshot.completionStatus,
    },
    pillars,
    items,
    qualitySummary: "점수와 A~E는 dev-v1 인터뷰 데이터의 필수 항목·feature 충족도, 추출 신뢰도, 정보 품질, 근거 유형만 나타내며 차주의 상환능력이나 신용도를 뜻하지 않습니다.",
    disclaimer: "이 결과는 대출 승인·거절 또는 공식·추정 신용등급 판단이 아닙니다. 금융 의사결정에 단독 사용해서는 안 됩니다.",
    failureReasons: validationIssues.map((issue) => `${issue.code}: ${issue.message}`),
  };
}
