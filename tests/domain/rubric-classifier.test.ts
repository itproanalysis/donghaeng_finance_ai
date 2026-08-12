import { describe, expect, it } from "vitest";

import {
  DETERMINISTIC_DEV_RUBRIC_CLASSIFIER,
  RubricClassifierOutputValidationError,
  calculateLiveFeatures,
  parseRubricClassifierOutput,
  validateRubricClassifierOutput,
  type CanonicalInformationRecord,
  type ImprovementPlanValue,
  type RubricClassifierPort,
} from "../../src/domain";

const PLAN: ImprovementPlanValue = {
  schemaVersion: "dev-v1",
  kind: "IMPROVEMENT_PLAN",
  planExists: true,
  problem: "원재료 폐기가 반복되어 고정비 부담이 커지고 있습니다",
  actions: [
    {
      text: "발주량을 매주 조정합니다",
      evidenceSpan: { start: 0, end: 13, text: "발주량을 매주 조정합니다" },
    },
  ],
  owner: "BORROWER",
  schedule: {
    schemaVersion: "dev-v1",
    kind: "DURATION",
    duration: { kind: "EXACT", value: 3 },
    unit: "MONTH",
    basis: "PLAN_SCHEDULE",
    derivedFrom: null,
  },
  baseline: { value: { kind: "EXACT", value: 10 }, unit: "%" },
  target: { value: { kind: "EXACT", value: 5 }, unit: "%" },
  measurementSources: ["POS"],
  origin: "BORROWER_DIRECT",
};

function planRecord(): CanonicalInformationRecord {
  return {
    infoCode: "improvement_plan",
    category: "IMPROVEMENT_INTENT",
    required: true,
    priority: "P0",
    minQuality: "MEDIUM",
    status: "CONFIRMED",
    valueState: "PRESENT",
    selectedRevisionId: "revision-plan",
    revisions: [
      {
        id: "revision-plan",
        infoCode: "improvement_plan",
        revision: 1,
        valueState: "PRESENT",
        value: PLAN,
        quality: "HIGH",
        parserConfidence: 1,
        verification: "SELF_REPORTED",
        evidenceIds: ["e-plan"],
        observedAt: "2026-08-10T00:00:00.000Z",
        status: "SELECTED",
        supersedesRevisionId: null,
      },
    ],
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("rubric classifier structured-output boundary", () => {
  it("returns only level/reason/evidenceIds and is reproducible for the same input", () => {
    const input = {
      rubric: "plan_specificity" as const,
      plan: PLAN,
      allowedEvidenceIds: ["e-plan"],
    };
    const first = DETERMINISTIC_DEV_RUBRIC_CLASSIFIER.classify(input);
    const second = DETERMINISTIC_DEV_RUBRIC_CLASSIFIER.classify(input);

    expect(first).toEqual(second);
    expect(Object.keys(first as object).sort()).toEqual([
      "evidenceIds",
      "level",
      "reason",
    ]);
    expect(first).toMatchObject({ level: 5, evidenceIds: ["e-plan"] });
    expect(validateRubricClassifierOutput(first, new Set(["e-plan"]))).toEqual([]);
  });

  it.each([
    {
      name: "classifier-supplied normalized field",
      output: { level: 3, reason: "근거 있음", evidenceIds: ["e-plan"], normalized: 0.99 },
      code: "UNEXPECTED_OUTPUT_KEYS",
    },
    {
      name: "out-of-range level",
      output: { level: 6, reason: "근거 있음", evidenceIds: ["e-plan"] },
      code: "INVALID_LEVEL",
    },
    {
      name: "fractional level",
      output: { level: 2.5, reason: "근거 있음", evidenceIds: ["e-plan"] },
      code: "INVALID_LEVEL",
    },
    {
      name: "empty reason",
      output: { level: 3, reason: "   ", evidenceIds: ["e-plan"] },
      code: "EMPTY_REASON",
    },
    {
      name: "unknown evidence lineage",
      output: { level: 3, reason: "근거 있음", evidenceIds: ["e-other"] },
      code: "UNKNOWN_EVIDENCE_ID",
    },
  ])("rejects $name", ({ output, code }) => {
    const issues = validateRubricClassifierOutput(output, new Set(["e-plan"]));
    expect(issues.map((issue) => issue.code)).toContain(code);
    expect(() => parseRubricClassifierOutput(output, new Set(["e-plan"]))).toThrow(
      RubricClassifierOutputValidationError,
    );
  });
});

describe("feature-engine rubric normalization", () => {
  it("computes normalized=level/5 on the server and retains allowed classifier lineage", () => {
    const classifier: RubricClassifierPort = {
      classify: ({ rubric }) => ({
        level: rubric === "plan_specificity" ? 3 : 2,
        reason: "테스트용 검증된 rubric 결과",
        evidenceIds: ["e-plan"],
      }),
    };

    const features = calculateLiveFeatures({
      records: [planRecord()],
      stateVersion: 1,
      rubricClassifier: classifier,
    });
    expect(features.features.find((feature) => feature.name === "plan_specificity")).toMatchObject({
      state: "COMPUTED",
      raw: {
        level: 3,
        reason: "테스트용 검증된 rubric 결과",
        evidenceIds: ["e-plan"],
      },
      normalized: 0.6,
      evidenceIds: ["e-plan"],
      formula: "rubric_level / 5",
      verification: "SYSTEM_DERIVED",
    });
    expect(features.features.find((feature) => feature.name === "problem_specificity")).toMatchObject({
      normalized: 0.4,
    });
  });

  it("fails closed before producing features when a classifier attempts to inject normalized", () => {
    const maliciousClassifier: RubricClassifierPort = {
      classify: () => ({
        level: 5,
        reason: "정상처럼 보이는 출력",
        evidenceIds: ["e-plan"],
        normalized: 0,
      }),
    };

    expect(() =>
      calculateLiveFeatures({
        records: [planRecord()],
        stateVersion: 1,
        rubricClassifier: maliciousClassifier,
      }),
    ).toThrow(RubricClassifierOutputValidationError);
  });

  it("keeps the default dev feature output deterministic", () => {
    const input = { records: [planRecord()], stateVersion: 1 };
    expect(calculateLiveFeatures(input)).toEqual(calculateLiveFeatures(input));
  });
});
