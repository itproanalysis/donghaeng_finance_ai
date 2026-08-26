import { describe, expect, it } from "vitest";

import {
  DEV_V1_INFORMATION_CATALOG,
  assessInterviewCompletion,
  buildEvidenceLinkedSummary,
  buildInterviewDataQualityEvaluationV1,
  calculateLiveFeatures,
  createCanonicalValueRevision,
  extractGoalSnapshot,
  featurePreviewDelta,
  parseCanonicalInformation,
  selectCanonicalRevision,
  summaryPreviewDelta,
  validateFeatureRegistry,
  validateImmutableFinalSnapshotV1,
  type BorrowerFinalConfirmation,
  type CanonicalInformationRecord,
  type CanonicalInformationValue,
  type EvidenceRef,
  type ImmutableFinalInterviewSnapshotV1,
} from "../../src/domain";

const ANSWERS: Record<string, string> = {
  monthly_average_sales: "월평균 매출은 2,300만원입니다",
  fixed_operating_costs: "고정비는 월 1,000만원입니다",
  improvement_plan:
    "개선 계획은 폐기 비용이 문제입니다. 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
  execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
  confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
  seasonality_outlook: "계절성 전망은 작년보다 수요가 10% 증가할 것으로 봅니다",
  essential_household_expenses: "필수 가계지출은 월 300만원입니다",
  emergency_buffer_months: "비상자금은 4개월입니다",
};

function records(): CanonicalInformationRecord[] {
  return DEV_V1_INFORMATION_CATALOG.map((definition, index) => {
    const candidate = parseCanonicalInformation(
      definition.infoCode,
      ANSWERS[definition.infoCode],
    );
    if (!candidate?.value) throw new Error(`fixture parse failed: ${definition.infoCode}`);
    const revision = createCanonicalValueRevision({
      id: `r-${definition.infoCode}`,
      infoCode: definition.infoCode,
      valueState: "PRESENT",
      value: candidate.value,
      quality: definition.minQuality,
      parserConfidence: 1,
      verification: "SELF_REPORTED",
      evidenceIds: [`e-${definition.infoCode}`],
      observedAt: `2026-08-10T00:00:0${index}.000Z`,
    });
    return {
      infoCode: definition.infoCode,
      category: definition.category,
      required: definition.required,
      priority: definition.priority,
      minQuality: definition.minQuality,
      status: "CONFIRMED",
      valueState: "PRESENT",
      selectedRevisionId: revision.id,
      revisions: selectCanonicalRevision([revision], revision.id),
      updatedAt: revision.observedAt,
    };
  });
}

function evidence(recordsInput: CanonicalInformationRecord[]): EvidenceRef[] {
  const refs = recordsInput.flatMap((record) =>
    record.revisions.flatMap((revision) =>
      revision.evidenceIds.map((id) => ({
        id,
        interviewId: "i1",
        infoCode: record.infoCode,
        kind: revision.verification,
        source: "borrower_statement",
        transcriptSegmentId: null,
        excerpt: ANSWERS[record.infoCode] ?? null,
        observedAt: revision.observedAt,
        metadata: {},
      })),
    ),
  );
  refs.push({
    id: "e-final-confirmation",
    interviewId: "i1",
    infoCode: "improvement_plan",
    kind: "SELF_REPORTED",
    source: "borrower_final_confirmation",
    transcriptSegmentId: null,
    excerpt: "위 요약을 확인했습니다.",
    observedAt: "2026-08-10T00:10:00.000Z",
    metadata: {},
  });
  return refs;
}

const confirmation: BorrowerFinalConfirmation = {
  status: "CONFIRMED",
  confirmedAt: "2026-08-10T00:10:00.000Z",
  transcriptSegmentId: "t-final",
  evidenceId: "e-final-confirmation",
};

describe("dev-v1 feature registry/engine", () => {
  it("지원 가능한 raw/derived feature와 evidence/formula를 결정론적으로 계산한다", () => {
    const information = records();
    const features = calculateLiveFeatures({ records: information, stateVersion: 8 });

    expect(validateFeatureRegistry()).toEqual([]);
    expect(features.features.find((feature) => feature.name === "fixed_cost_ratio")).toMatchObject({
      state: "COMPUTED",
      verification: "SYSTEM_DERIVED",
      formula: "fixed_operating_costs / monthly_average_sales",
      raw: { kind: "EXACT", value: 10_000_000 / 23_000_000 },
    });
    expect(features.features.find((feature) => feature.name === "plan_specificity")).toMatchObject({
      state: "COMPUTED",
      normalized: 1,
    });
    expect(features.features.find((feature) => feature.name === "business_tenure_months")).toMatchObject({
      state: "MISSING",
      raw: null,
    });
    expect(features.features.every((feature) => feature.registryVersion === "dev-v1")).toBe(true);
  });

  it("매출 0 denominator를 0 ratio로 만들지 않고 NOT_CALCULABLE로 남긴다", () => {
    const information = records();
    const sales = information.find((record) => record.infoCode === "monthly_average_sales")!;
    const revision = sales.revisions[0];
    const value = revision.value as Extract<CanonicalInformationValue, { kind: "PERIODIC_MONEY" }>;
    revision.value = { ...value, amount: { kind: "EXACT", value: 0 } };
    const features = calculateLiveFeatures({ records: information, stateVersion: 9 });
    expect(features.features.find((feature) => feature.name === "fixed_cost_ratio")).toMatchObject({
      state: "NOT_CALCULABLE",
      normalized: null,
    });
  });

  it("feature와 summary delta가 실제 변경만 반환하고 요약 문장에 evidence를 연결한다", () => {
    const information = records();
    const before = calculateLiveFeatures({ records: information.slice(0, 1), stateVersion: 1 });
    const after = calculateLiveFeatures({ records: information, stateVersion: 8 });
    expect(featurePreviewDelta(before, after).length).toBeGreaterThan(0);
    const beforeSummary = buildEvidenceLinkedSummary({
      records: information.slice(0, 1),
      features: before,
      version: 1,
      generatedAt: "2026-08-10T00:00:00.000Z",
    });
    const afterSummary = buildEvidenceLinkedSummary({
      records: information,
      features: after,
      version: 8,
      generatedAt: "2026-08-10T00:10:00.000Z",
    });
    expect(summaryPreviewDelta(beforeSummary, afterSummary).length).toBeGreaterThan(0);
    expect(afterSummary.sections).toHaveLength(7);
    expect(afterSummary.sections.at(-1)).toEqual({
      kind: "FOLLOWUP_ITEMS",
      text: "추가 확인이 필요한 필수정보가 없습니다.",
      evidenceIds: [],
      asOf: "2026-08-10T00:10:00.000Z",
      gapStatement: true,
    });
    expect(afterSummary.sections.filter((section) => !section.gapStatement).every((section) => section.evidenceIds.length > 0)).toBe(true);
    const planSummary = afterSummary.sections.find(
      (section) => section.kind === "BORROWER_IMPROVEMENT_PLAN",
    );
    expect(planSummary?.text).toBe(
      "차주가 직접 말한 개선 내용입니다. 개선 계획은 폐기 비용이 문제입니다. 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
    );
    expect(planSummary?.text).not.toMatch(/(?:문제입니다|하겠습니다)\.입니다/);
  });
});

describe("goal, strict/forced completion, immutable FINAL, A~E data-quality evaluation", () => {
  function assess(
    mode: "STRICT" | "FORCE_INCOMPLETE",
    information = records(),
    forceReason?: string,
    borrowerConfirmation: BorrowerFinalConfirmation = confirmation,
  ) {
    const features = calculateLiveFeatures({ records: information, stateVersion: 8 });
    const manifest = evidence(information);
    return {
      features,
      manifest,
      goal: extractGoalSnapshot(information),
      assessment: assessInterviewCompletion({
        mode,
        records: information,
        featureSet: features,
        goal: extractGoalSnapshot(information),
        borrowerConfirmation,
        knownEvidenceIds: new Set(manifest.map((item) => item.id)),
        catalogValid: true,
        activeTurn: false,
        finalTranscriptPending: false,
        unresolvedConflictInfoCodes: [],
        forceReason,
      }),
    };
  }

  it("차주 직접 baseline/target/기간/source가 있을 때만 목표를 CONFIRMED한다", () => {
    const goal = extractGoalSnapshot(records());
    expect(goal).toMatchObject({
      status: "CONFIRMED",
      numericStatus: "DIRECT",
      origin: "BORROWER_STATED",
      baseline: { value: { kind: "EXACT", value: 10 }, unit: "%" },
      target: { value: { kind: "EXACT", value: 5 }, unit: "%" },
      period: { value: 3, unit: "MONTH" },
    });
    expect(goal.evidenceIds).toEqual(["e-improvement_plan"]);
  });

  it("수치 없는 계획에 임의 30%를 생성하지 않고 completion blocker를 반환한다", () => {
    const information = records();
    const plan = information.find((record) => record.infoCode === "improvement_plan")!;
    const revision = plan.revisions[0];
    const value = revision.value as Extract<CanonicalInformationValue, { kind: "IMPROVEMENT_PLAN" }>;
    revision.value = {
      ...value,
      baseline: null,
      target: null,
      schedule: null,
      measurementSources: [],
    };
    const result = assess("STRICT", information);
    expect(result.goal.target).toBeNull();
    expect(result.goal.status).toBe("NEEDS_FOLLOWUP");
    expect(result.assessment.blockers.map((blocker) => blocker.code)).toContain(
      "GOAL_STATUS_UNRESOLVED",
    );
    expect(result.assessment.canFinalize).toBe(false);
  });

  it("STRICT은 모든 gate 통과 시 COMPLETE/eligible, FORCE는 reason과 함께 INCOMPLETE/not eligible이다", () => {
    const strict = assess("STRICT");
    expect(strict.assessment).toMatchObject({
      readyForStrictCompletion: true,
      canFinalize: true,
      completionStatus: "COMPLETE",
      evaluationEligible: true,
      blockers: [],
    });
    const forcedWithoutReason = assess("FORCE_INCOMPLETE");
    expect(forcedWithoutReason.assessment.canFinalize).toBe(false);
    expect(forcedWithoutReason.assessment.blockers.map((blocker) => blocker.code)).toContain(
      "FORCE_REASON_REQUIRED",
    );
    const forced = assess("FORCE_INCOMPLETE", records(), "차주 요청으로 중단");
    expect(forced.assessment).toMatchObject({
      canFinalize: true,
      completionStatus: "INCOMPLETE",
      evaluationEligible: false,
    });
    const forcedWithoutConfirmation = assess(
      "FORCE_INCOMPLETE",
      records(),
      "차주 요청으로 중단",
      {
        status: "PENDING",
        confirmedAt: null,
        transcriptSegmentId: null,
        evidenceId: null,
      },
    );
    expect(forcedWithoutConfirmation.assessment.canFinalize).toBe(false);
    expect(
      forcedWithoutConfirmation.assessment.blockers.map((blocker) => blocker.code),
    ).toContain("BORROWER_CONFIRMATION_MISSING");
  });

  it("FINAL evidence integrity를 검증하고 4축 A~E를 신용등급과 분리한다", () => {
    const information = records();
    const { features, manifest, goal, assessment } = assess("STRICT", information);
    const summary = buildEvidenceLinkedSummary({
      records: information,
      features: { ...features, snapshotType: "FINAL" },
      version: 8,
      generatedAt: "2026-08-10T00:10:00.000Z",
      snapshotType: "FINAL",
    });
    const snapshot: ImmutableFinalInterviewSnapshotV1 = {
      id: "final-1",
      interviewId: "i1",
      snapshotType: "FINAL",
      schemaVersion: "dev-v1",
      stateVersion: 8,
      finalizedAt: "2026-08-10T00:10:00.000Z",
      completionStatus: "COMPLETE",
      completionAssessment: assessment,
      borrower: { id: "b1", name: "김동행" },
      business: { id: "biz1", borrowerId: "b1", businessName: "동행 카페", industry: "카페" },
      informationItems: information,
      features: { ...features, snapshotType: "FINAL" },
      goalSnapshot: goal,
      borrowerSummary: { ...summary, snapshotType: "FINAL" },
      transcript: [],
      evidenceManifest: manifest,
      versions: {
        valueSchema: "dev-v1",
        parser: "dev-v1",
        featureRegistry: "dev-v1",
        goalPolicy: "dev-v1",
        completionPolicy: "dev-v1",
        evaluationPolicy: "dev-v1",
      },
      contentHash: "sha256:test",
    };
    expect(validateImmutableFinalSnapshotV1(snapshot)).toEqual([]);
    const first = buildInterviewDataQualityEvaluationV1(snapshot);
    const second = buildInterviewDataQualityEvaluationV1(structuredClone(snapshot));
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: "READY",
      decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
      gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
      approvalDecision: null,
      creditGrade: null,
      overall: { grade: "A", completionStatus: "COMPLETE" },
    });
    expect(first.disclaimer).toMatch(/승인·거절|신용등급/);
  });

  it("INCOMPLETE snapshot은 A~E를 생성하지 않고 UNGRADED/NOT_ELIGIBLE이다", () => {
    const information = records();
    const { features, manifest, goal } = assess("FORCE_INCOMPLETE", information, "차주 요청");
    const forcedAssessment = assess("FORCE_INCOMPLETE", information, "차주 요청").assessment;
    const summary = buildEvidenceLinkedSummary({
      records: information,
      features: { ...features, snapshotType: "FINAL" },
      version: 8,
      generatedAt: "2026-08-10T00:10:00.000Z",
      snapshotType: "FINAL",
    });
    const snapshot: ImmutableFinalInterviewSnapshotV1 = {
      id: "final-incomplete",
      interviewId: "i1",
      snapshotType: "FINAL",
      schemaVersion: "dev-v1",
      stateVersion: 8,
      finalizedAt: "2026-08-10T00:10:00.000Z",
      completionStatus: "INCOMPLETE",
      completionAssessment: forcedAssessment,
      borrower: { id: "b1", name: "김동행" },
      business: { id: "biz1", borrowerId: "b1", businessName: "동행 카페", industry: "카페" },
      informationItems: information,
      features: { ...features, snapshotType: "FINAL" },
      goalSnapshot: goal,
      borrowerSummary: { ...summary, snapshotType: "FINAL" },
      transcript: [],
      evidenceManifest: manifest,
      versions: { valueSchema: "dev-v1", parser: "dev-v1", featureRegistry: "dev-v1", goalPolicy: "dev-v1", completionPolicy: "dev-v1", evaluationPolicy: "dev-v1" },
      contentHash: "sha256:test-incomplete",
    };
    const evaluation = buildInterviewDataQualityEvaluationV1(snapshot);
    expect(evaluation.status).toBe("NOT_ELIGIBLE");
    expect(evaluation.overall.grade).toBe("UNGRADED");
    expect(evaluation.approvalDecision).toBeNull();
  });
});
