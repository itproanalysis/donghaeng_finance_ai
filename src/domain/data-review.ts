import type { FeatureV2Definition, FeatureV2Value } from "./improvement-feature-pipeline";
import type { CanonicalInformationRecord, CanonicalValueRevision } from "./information-values";
import type { EvidenceRef } from "./interview";
import type { AllowlistedImprovementCandidate, BorrowerImprovementSelection } from "./improvement-candidate-selection";

export const FEATURE_GROUP_LABELS = {
  business: "사업 현황", financial: "재무 / 거래", credit: "채무 / 신용",
  operation: "운영 효율", owner: "사장님 인터뷰", external: "외부 환경", improvement: "개선 가능성",
} as const;
export const SIGNAL_LABELS = {
  imp_recovery_momentum: "사업 회복 흐름", imp_cashflow_stabilization: "현금흐름 안정 신호",
  imp_cost_adjustment_headroom: "비용 조정 여지", imp_sales_recovery_potential: "매출 회복 신호",
  imp_plan_specificity: "계획 구체성", imp_plan_feasibility: "실행 준비 정보",
} as const;
export interface FeatureTrace {
  featureNames: string[];
  infoCode: string;
  revisionId: string | null;
  evidenceIds: string[];
}
export interface ReviewFeature extends FeatureV2Value {
  definition: FeatureV2Definition;
  traces: FeatureTrace[];
  expectedInputs: string[];
  missingInputs: string[];
  evidenceIds: string[];
  interpretation: string;
}
export interface DataReview {
  interviewId: string;
  businessName: string;
  borrowerName: string;
  version: number;
  snapshotType: "PREVIEW" | "FINAL";
  lifecycleStatus: string;
  finalHash: string | null;
  featureArtifactOrigin: "LIVE_SERVER" | "FROZEN_FINAL" | "LEGACY_PROJECTION";
  schemaVersion: string | null;
  enabled: boolean;
  metrics: {
    confirmed: number; needed: number; evidence: number; computed: number; missing: number; notCalculable: number;
    totalFeatures: number; evidenceCovered: number; totalInformation: number;
    resolvedRequired: number; totalRequired: number;
  };
  canonical: Array<CanonicalInformationRecord & { selected: CanonicalValueRevision | null }>;
  evidence: Array<EvidenceRef & { originalText: string | null }>;
  features: ReviewFeature[];
  candidates: AllowlistedImprovementCandidate[];
  selection: BorrowerImprovementSelection | null;
  summary: string | null;
}
