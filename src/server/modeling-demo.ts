import modelingPayload from "@/generated/modeling-demo.json";

export type ModelingValue = string | number | boolean | null | ModelingValue[] | { [key: string]: ModelingValue };

export interface ModelingFeature {
  ordinal: number;
  code: string;
  label: string;
  description: string;
  source: string;
  sourceLabel: string;
  dtype: string;
  role: string;
  roles: string[];
  featureVectorMember: boolean;
  usedInScore: boolean;
  usedForQuestionTrigger: boolean;
  value: ModelingValue;
  status: string;
  evidenceRefs: string[];
}

export interface ModelingLineage {
  kind: string;
  feature: string;
  label: string;
  source: string;
  sourceLabel: string;
  value: ModelingValue;
  status: string;
  featureVectorMember: boolean;
  evidenceRefs: string[];
}

export interface ModelingScoreItem {
  name: string;
  points: number | null;
  maxPoints: number;
  excluded: boolean;
  band: string;
  note: string;
  normalizedContribution: number | null;
  lineage: ModelingLineage[];
}

export interface ModelingAxis {
  axis: string;
  score: number | string;
  itemsUsed: number;
  itemsTotal: number;
  basis: string;
  note: string;
  items: ModelingScoreItem[];
  accounting: {
    earnedPoints: number;
    availablePoints: number;
    totalPossiblePoints: number;
    coverageRatio: number;
    formula: string;
    excludedItems: string[];
    isConfidence: false;
  };
}

export interface ModelingCase {
  caseId: string;
  ordinal: number;
  title: string;
  summary: string;
  verificationPurpose: string;
  mock: boolean;
  modelingEffect: ModelingBundle["comparisons"]["interviewEffect"];
  sourceSummary: Array<{
    source: string;
    sourceLabel: string;
    featureCount: number;
    valueCount: number;
    statusCounts: Record<string, number>;
  }>;
  featureSummary: {
    total: number;
    valueCount: number;
    statusCounts: Record<string, number>;
  };
  features: ModelingFeature[];
  triggers: Array<{
    code: string;
    label: string;
    fired: boolean;
    inputFeature: string;
    inputFeatureVectorMember: boolean;
    inputSource: string;
    inputValue: ModelingValue;
    inputStatus: string;
    threshold: { operator: string; value: number };
    fills: string[];
  }>;
  interviewConversion: {
    method: string;
    interviewPresent: boolean;
    items: Array<{
      feature: string;
      label: string;
      value: ModelingValue;
      status: string;
      evidenceId: string | null;
      evidenceText: string | null;
      evidencePresent: boolean;
    }>;
    rawMaterials: Array<{ code: string; value: ModelingValue; status: string; usedBy: string[] }>;
    disclaimer: string;
  };
  scorecard: {
    currentSituation: ModelingAxis;
    improvement: ModelingAxis;
    disclaimer: string;
  };
  cbContrast: {
    legacyCb: {
      score: ModelingValue;
      grade: ModelingValue;
      percentile: ModelingValue;
      delinquencyProbability: ModelingValue;
      monthlyDebtPayment: ModelingValue;
      opinion: string;
    };
    donghaengContext: { fields: ModelingLineage[]; featureCount: number };
    disclaimer: string;
  };
  externalContext: {
    role: "CONTEXT_ONLY";
    sourceAvailable: boolean;
    includedInFeatureVector: false;
    includedInScore: false;
    fields: Array<{
      code: string;
      source: string;
      sourceLabel: string;
      dtype: string;
      role: "CONTEXT_ONLY";
      roles: string[];
      value: ModelingValue;
      status: string;
      featureVectorMember: false;
      usedInScore: false;
    }>;
    seasonalityQuestionRequired: { value: ModelingValue; status: string; threshold: number };
    disclaimer: string;
  };
}

export interface ModelingBundle {
  schemaVersion: string;
  model: {
    version: string;
    kind: string;
    trainedModel: boolean;
    prediction: boolean;
    approvalDecision: boolean;
    featureCount: number;
    sourceCounts: Array<{ source: string; sourceLabel: string; featureCount: number }>;
    axes: Array<{ code: string; label: string; maxScore: number }>;
    authoritativeModules: string[];
  };
  featureCatalog: ModelingFeature[];
  cases: ModelingCase[];
  comparisons: {
    sameSalesDecline: {
      title: string;
      caseIds: string[];
      cases: Array<{
        caseId: string;
        title: string;
        salesGrowth3m: ModelingValue;
        salesDropDriver: ModelingValue;
        transactionCountGrowth3m: ModelingValue;
        averageTicketGrowth3m: ModelingValue;
        operatingDayChange3m: ModelingValue;
        salesPerOperatingDay3m: ModelingValue;
        currentSituationScore: ModelingValue;
        improvementScore: ModelingValue;
        salesDirection: {
          points: number | null;
          band: string;
          note: string;
          lineage: ModelingLineage[];
        };
      }>;
      invariants: {
        salesGrowthEqual: boolean;
        salesGrowth: ModelingValue;
        currentSituationEqual: boolean;
        onlyDifferingImprovementItems: string[];
      };
      conclusion: string;
    };
    interviewEffect: {
      caseId: string;
      method: string;
      before: {
        label: string;
        interviewPresent: boolean;
        featureSummary: { total: number; statusCounts: Record<string, number> };
        scorecard: ModelingCase["scorecard"];
        interviewConversion: ModelingCase["interviewConversion"];
      };
      after: {
        label: string;
        interviewPresent: boolean;
        featureSummary: ModelingCase["featureSummary"];
        scorecard: ModelingCase["scorecard"];
        interviewConversion: ModelingCase["interviewConversion"];
      };
      changedFeatures: Array<{
        feature: string;
        label: string;
        before: ModelingValue;
        beforeStatus: string;
        after: ModelingValue;
        afterStatus: string;
        source: string;
        metricLinks: Array<{ axis: "currentSituation" | "improvement"; item: string }>;
      }>;
      changedScoreItems: Array<Record<string, ModelingValue>>;
      improvementScoreDelta: number | null;
      basisComparable: boolean;
      comparisonWarning: string;
      structuredInputsUnchanged: boolean;
    };
  };
  reevaluation: {
    beforeCase: string;
    afterCase: string;
    goalFeature: string;
    before: ModelingValue;
    after: ModelingValue;
    target: ModelingValue;
    horizonDays: ModelingValue;
    direction: string;
    reached: ModelingValue;
    sameFeaturePipeline: boolean;
    afterInterviewReused: boolean;
    afterInterviewFeatureStatusCounts: Record<string, number>;
    baselineAsOf: string;
    followupAsOf: string;
    recordSource: string;
    measurementRule: string;
    monthlyRecords: Array<{
      month: string;
      sales: number;
      transactions: number;
      operatingDays: number;
      includedInGoal: boolean;
    }>;
    comparisonOperator: string;
    disclaimer: string;
  };
  validation: {
    nature: string;
    mockData: boolean;
    mockCaseCount: number;
    realOutcomeRecordCount: number;
    trainedModel: boolean;
    predictionValidated: boolean;
    thresholds: string;
    featureVector: { passed: boolean; count: number };
    conditionalQuestionRules: { passed: boolean; covered: number; total: number; codes: string[] };
    scorecardBands: { executed: number; total: number; unexecuted: number; unexecutedBands: Array<{ item: string; band: string }> };
    missingStates: string[];
    bundleContract: { passed: boolean; errors: string[] };
    existingModelingValidation: {
      passed: boolean | null;
      checksPassed: number | null;
      checksTotal: number | null;
      steps: Array<{ step: number; passed: number; total: number }>;
      failed: Array<{ step: number; name: string; note: string }>;
    };
    limitations: string[];
    sourceCodeChecksum: { algorithm: string; value: string };
    checksum: { algorithm: string; scope: string; value: string };
  };
}

const bundle = modelingPayload as unknown as ModelingBundle;
const cases = new Map(bundle.cases.map((item) => [item.caseId, item]));

if (bundle.schemaVersion !== "modeling_web_v1" || bundle.model.featureCount !== 94 || cases.size !== bundle.cases.length) {
  throw new Error("Invalid generated modeling demo artifact");
}

export const DEFAULT_MODELING_CASE_ID = "case_operating_drop";

export function isModelingCaseId(value: string): boolean {
  return cases.has(value);
}

export function getModelingCase(caseId = DEFAULT_MODELING_CASE_ID): ModelingCase | null {
  return cases.get(caseId) ?? null;
}

export function getModelingBundle(): ModelingBundle {
  return bundle;
}

export function getModelingIndex() {
  return {
    schemaVersion: bundle.schemaVersion,
    model: bundle.model,
    defaultCaseId: DEFAULT_MODELING_CASE_ID,
    cases: bundle.cases.map((item) => ({
      caseId: item.caseId,
      ordinal: item.ordinal,
      title: item.title,
      verificationPurpose: item.verificationPurpose,
      mock: item.mock,
      featureSummary: item.featureSummary,
      scores: {
        currentSituation: item.scorecard.currentSituation.score,
        improvement: item.scorecard.improvement.score,
      },
    })),
    comparisons: bundle.comparisons,
    reevaluation: bundle.reevaluation,
    validation: bundle.validation,
  };
}
