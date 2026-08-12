import { describe, expect, it } from "vitest";

import {
  DEV_V1_FEATURE_REGISTRY,
  DEV_V1_INFORMATION_CATALOG,
  assessInterviewCompletion,
  assertInformationTransition,
  buildEvidenceLinkedSummary,
  buildInterviewDataQualityEvaluationV1,
  calculateLiveFeatures,
  createCanonicalValueRevision,
  createDefaultRequiredInformationItems,
  detectCanonicalValueConflict,
  extractGoalSnapshot,
  markConflictRevisions,
  parseCanonicalInformation,
  planDeterministicInterviewTurn,
  resolveCanonicalConflict,
  selectCanonicalRevision,
  validateImmutableFinalSnapshotV1,
  type CanonicalConflict,
  type CanonicalInformationRecord,
  type CanonicalInformationValue,
  type DevV1InfoCode,
  type EvidenceRef,
  type ImmutableFinalInterviewSnapshotV1,
  type InformationItem,
  type LiveFeatureSet,
} from "../../src/domain";
import {
  ALL_DEV_V1_INFO_CODES,
  SOHO_SCENARIO_FIXTURES,
  type SohoExpectedStateTransition,
  type SohoScenarioFixture,
} from "./soho-scenarios";

interface ScenarioPipelineResult {
  records: CanonicalInformationRecord[];
  transitions: SohoExpectedStateTransition[];
  turnStatuses: Array<{ infoCode: DevV1InfoCode; status: string }>;
  extractedInfoCodesByTurn: DevV1InfoCode[][];
  features: LiveFeatureSet;
  goal: ReturnType<typeof extractGoalSnapshot>;
  evaluation: ReturnType<typeof buildInterviewDataQualityEvaluationV1>;
  finalSnapshotIssues: ReturnType<typeof validateImmutableFinalSnapshotV1>;
  conflictsDetected: number;
  conflictsResolved: number;
}

function initialInformationItems(): InformationItem[] {
  return createDefaultRequiredInformationItems().map((item, index) => ({
    ...item,
    valueState: "MISSING",
    value: null,
    quality: null,
    extractionConfidence: null,
    verification: null,
    evidenceIds: [],
    prefill: null,
    updatedAt: `2026-08-10T00:00:0${index}.000Z`,
  }));
}

function initialCanonicalRecords(): CanonicalInformationRecord[] {
  return DEV_V1_INFORMATION_CATALOG.map((definition, index) => ({
    infoCode: definition.infoCode,
    category: definition.category,
    required: definition.required,
    priority: definition.priority,
    minQuality: definition.minQuality,
    status: definition.status,
    valueState: "MISSING",
    selectedRevisionId: null,
    revisions: [],
    updatedAt: `2026-08-10T00:00:0${index}.000Z`,
  }));
}

function runScenario(fixture: SohoScenarioFixture): ScenarioPipelineResult {
  let informationItems = initialInformationItems();
  let records = initialCanonicalRecords();
  const evidenceManifest: EvidenceRef[] = [];
  const transitions: SohoExpectedStateTransition[] = [];
  const turnStatuses: ScenarioPipelineResult["turnStatuses"] = [];
  const extractedInfoCodesByTurn: DevV1InfoCode[][] = [];
  let openConflict: CanonicalConflict | null = null;
  let conflictsDetected = 0;
  let conflictsResolved = 0;

  if (fixture.prefill) {
    const candidate = parseCanonicalInformation(
      fixture.prefill.infoCode,
      fixture.prefill.text,
    );
    if (!candidate?.value) {
      throw new Error(`${fixture.id}: prefill did not produce a canonical value`);
    }
    const value: CanonicalInformationValue =
      candidate.value.kind === "PERIODIC_MONEY" && fixture.prefill.channels
        ? { ...candidate.value, channels: [...fixture.prefill.channels] }
        : candidate.value;
    const evidenceId = `e-${fixture.id}-prefill`;
    const observedAt = "2026-08-10T00:00:10.000Z";
    const revision = createCanonicalValueRevision({
      id: `r-${fixture.id}-prefill`,
      infoCode: fixture.prefill.infoCode,
      valueState: "PRESENT",
      value,
      quality: candidate.quality,
      parserConfidence: candidate.parserConfidence,
      verification: "TRANSACTION_SUPPORTED",
      evidenceIds: [evidenceId],
      observedAt,
    });
    records = records.map((record) =>
      record.infoCode === fixture.prefill?.infoCode
        ? {
            ...record,
            valueState: "PRESENT",
            selectedRevisionId: revision.id,
            revisions: selectCanonicalRevision([revision], revision.id),
            updatedAt: observedAt,
          }
        : record,
    );
    evidenceManifest.push({
      id: evidenceId,
      interviewId: fixture.id,
      infoCode: fixture.prefill.infoCode,
      kind: "TRANSACTION_SUPPORTED",
      source: "fixture_prefill",
      transcriptSegmentId: null,
      excerpt: fixture.prefill.text,
      observedAt,
      metadata: { channels: fixture.prefill.channels ?? [] },
    });
  }

  for (const [turnIndex, turn] of fixture.transcript.entries()) {
    const plan = planDeterministicInterviewTurn({
      text: turn.text,
      currentInfoCode: turn.currentInfoCode,
      informationItems,
    });
    extractedInfoCodesByTurn.push(
      plan.extractedItems.map((candidate) => candidate.infoCode as DevV1InfoCode),
    );
    transitions.push(
      ...plan.stateChanges.map((change) => ({
        infoCode: change.infoCode as DevV1InfoCode,
        from: change.from,
        to: change.to,
      })),
    );
    const finalStatusByCode = new Map(
      plan.stateChanges.map((change) => [change.infoCode, change.to]),
    );
    informationItems = informationItems.map((item) => ({
      ...item,
      status: finalStatusByCode.get(item.infoCode) ?? item.status,
    }));
    records = records.map((record) => ({
      ...record,
      status: finalStatusByCode.get(record.infoCode) ?? record.status,
    }));

    for (const candidate of plan.extractedItems) {
      const record = records.find((entry) => entry.infoCode === candidate.infoCode);
      if (!record) throw new Error(`${fixture.id}: missing record ${candidate.infoCode}`);
      const previouslySelected = record.selectedRevisionId
        ? record.revisions.find((revision) => revision.id === record.selectedRevisionId) ?? null
        : null;
      const evidenceId = `e-${fixture.id}-${turnIndex}-${candidate.infoCode}`;
      const observedAt = `2026-08-10T00:01:${String(turnIndex).padStart(2, "0")}.000Z`;
      const revision = createCanonicalValueRevision(
        {
          id: `r-${fixture.id}-${turnIndex}-${candidate.infoCode}`,
          infoCode: candidate.infoCode,
          valueState: candidate.valueState,
          value: candidate.value,
          quality: candidate.quality,
          parserConfidence: candidate.parserConfidence,
          verification: candidate.verification,
          evidenceIds: [evidenceId],
          observedAt,
          supersedesRevisionId: record.selectedRevisionId,
        },
        record.revisions,
      );
      const selectedRevisions = selectCanonicalRevision(
        [...record.revisions, revision],
        revision.id,
      );
      records = records.map((entry) =>
        entry.infoCode === candidate.infoCode
          ? {
              ...entry,
              valueState: candidate.valueState,
              selectedRevisionId: revision.id,
              revisions: selectedRevisions,
              updatedAt: observedAt,
            }
          : entry,
      );
      evidenceManifest.push({
        id: evidenceId,
        interviewId: fixture.id,
        infoCode: candidate.infoCode,
        kind: candidate.verification,
        source: "fixture_transcript",
        transcriptSegmentId: `t-${fixture.id}-${turnIndex}`,
        excerpt: candidate.evidenceSpan.text,
        observedAt,
        metadata: { parserConfidence: candidate.parserConfidence },
      });

      if (
        fixture.prefill?.infoCode === candidate.infoCode &&
        previouslySelected &&
        !openConflict
      ) {
        const conflict = detectCanonicalValueConflict(
          `c-${fixture.id}-${turnIndex}`,
          previouslySelected,
          revision,
        );
        if (conflict) {
          assertInformationTransition("COLLECTED", "CONFLICT");
          openConflict = conflict;
          conflictsDetected += 1;
          const conflictingRecord = records.find(
            (entry) => entry.infoCode === candidate.infoCode,
          );
          if (!conflictingRecord) throw new Error("conflicting record disappeared");
          records = records.map((entry) =>
            entry.infoCode === candidate.infoCode
              ? {
                  ...entry,
                  status: "CONFLICT",
                  revisions: markConflictRevisions(entry.revisions, conflict),
                }
              : entry,
          );
          informationItems = informationItems.map((item) =>
            item.infoCode === candidate.infoCode ? { ...item, status: "CONFLICT" } : item,
          );
          const proposedConfirmationIndex = transitions.findLastIndex(
            (entry) =>
              entry.infoCode === candidate.infoCode &&
              entry.from === "COLLECTED" &&
              entry.to === "CONFIRMED",
          );
          if (proposedConfirmationIndex < 0 || conflictingRecord.status !== "CONFIRMED") {
            throw new Error(`${fixture.id}: expected proposed confirmation before conflict`);
          }
          transitions[proposedConfirmationIndex] = {
            infoCode: candidate.infoCode as DevV1InfoCode,
            from: "COLLECTED",
            to: "CONFLICT",
          };
        }
      } else if (openConflict?.infoCode === candidate.infoCode) {
        const currentRecord = records.find((entry) => entry.infoCode === candidate.infoCode);
        if (!currentRecord) throw new Error("resolution record disappeared");
        const resolved = resolveCanonicalConflict(
          openConflict,
          {
            type: "ACCEPT_REPORTED",
            selectedRevisionId: openConflict.candidateRevisionIds[1],
            resolutionRevisionId: revision.id,
            evidenceIds: revision.evidenceIds,
            reason: "fixture borrower reconciled the channel basis",
            resolvedAt: observedAt,
          },
          currentRecord.revisions,
        );
        records = records.map((entry) =>
          entry.infoCode === candidate.infoCode
            ? {
                ...entry,
                status: candidate.proposedStatus,
                valueState: candidate.valueState,
                selectedRevisionId: revision.id,
                revisions: resolved.revisions,
              }
            : entry,
        );
        openConflict = null;
        conflictsResolved += 1;
      }
    }

    const currentRecord = records.find(
      (record) => record.infoCode === turn.currentInfoCode,
    );
    if (!currentRecord) throw new Error(`${fixture.id}: missing current turn record`);
    turnStatuses.push({
      infoCode: turn.currentInfoCode,
      status: currentRecord.status,
    });
  }

  if (openConflict) throw new Error(`${fixture.id}: conflict was not resolved`);

  const stateVersion = Math.max(1, transitions.length);
  const features = calculateLiveFeatures({ records, stateVersion });
  const goal = extractGoalSnapshot(records);
  const knownEvidenceIds = new Set(evidenceManifest.map((evidence) => evidence.id));
  const completionAssessment = assessInterviewCompletion({
    mode: "FORCE_INCOMPLETE",
    records,
    featureSet: features,
    goal,
    borrowerConfirmation: {
      status: "PENDING",
      confirmedAt: null,
      transcriptSegmentId: null,
      evidenceId: null,
    },
    knownEvidenceIds,
    catalogValid: true,
    activeTurn: false,
    finalTranscriptPending: false,
    unresolvedConflictInfoCodes: [],
    forceReason: "fixture is intentionally a partial interview",
  });
  const finalFeatures = { ...features, snapshotType: "FINAL" as const };
  const borrowerSummary = buildEvidenceLinkedSummary({
    records,
    features: finalFeatures,
    version: stateVersion,
    generatedAt: "2026-08-10T00:10:00.000Z",
    snapshotType: "FINAL",
  });
  const finalSnapshot: ImmutableFinalInterviewSnapshotV1 = {
    id: `final-${fixture.id}`,
    interviewId: fixture.id,
    snapshotType: "FINAL",
    schemaVersion: "dev-v1",
    stateVersion,
    finalizedAt: "2026-08-10T00:10:00.000Z",
    completionStatus: "INCOMPLETE",
    completionAssessment,
    borrower: { id: `borrower-${fixture.id}`, name: "SOHO fixture borrower" },
    business: {
      id: `business-${fixture.id}`,
      borrowerId: `borrower-${fixture.id}`,
      businessName: `${fixture.industry} fixture`,
      industry: fixture.industry,
    },
    informationItems: records,
    features: finalFeatures,
    goalSnapshot: goal,
    borrowerSummary: { ...borrowerSummary, snapshotType: "FINAL" },
    transcript: [],
    evidenceManifest,
    versions: {
      valueSchema: "dev-v1",
      parser: "dev-v1",
      featureRegistry: "dev-v1",
      goalPolicy: "dev-v1",
      completionPolicy: "dev-v1",
      evaluationPolicy: "dev-v1",
    },
    contentHash: `sha256:fixture-${fixture.id}`,
  };

  return {
    records,
    transitions,
    turnStatuses,
    extractedInfoCodesByTurn,
    features,
    goal,
    evaluation: buildInterviewDataQualityEvaluationV1(finalSnapshot),
    finalSnapshotIssues: validateImmutableFinalSnapshotV1(finalSnapshot),
    conflictsDetected,
    conflictsResolved,
  };
}

describe("12 SOHO development fixtures", () => {
  it("covers all industries with only registered dev-v1 information and feature names", () => {
    expect(SOHO_SCENARIO_FIXTURES.map((fixture) => fixture.industry)).toEqual([
      "음식점",
      "카페",
      "온라인",
      "미용",
      "학원",
      "숙박",
      "인테리어",
      "정비",
      "소매",
      "운송",
      "도매",
      "신규사업",
    ]);
    const registeredFeatures = new Set(
      DEV_V1_FEATURE_REGISTRY.map((feature) => feature.name),
    );
    for (const fixture of SOHO_SCENARIO_FIXTURES) {
      expect(fixture.requiredList).toEqual(ALL_DEV_V1_INFO_CODES);
      expect(new Set(fixture.requiredList).size).toBe(8);
      expect(fixture.transcript.length).toBeGreaterThan(0);
      expect(fixture.expectedStateTransitions.length).toBeGreaterThan(0);
      expect(fixture.expectedFeatures.length).toBeGreaterThan(0);
      for (const expectedFeature of fixture.expectedFeatures) {
        expect(
          registeredFeatures.has(expectedFeature.name),
          `${fixture.id}: unregistered feature ${expectedFeature.name}`,
        ).toBe(true);
      }
      expect(fixture.expectedEvaluation.approvalDecision).toBeNull();
      expect(fixture.expectedEvaluation.gradeScope).toBe(
        "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
      );
    }
  });

  for (const fixture of SOHO_SCENARIO_FIXTURES) {
    it(`${fixture.id} executes parser, transitions, features, goal and evaluation`, () => {
      const result = runScenario(fixture);

      expect(result.turnStatuses).toEqual(
        fixture.transcript.map((turn) => ({
          infoCode: turn.currentInfoCode,
          status: turn.expectedStatus,
        })),
      );
      expect(result.transitions).toEqual(fixture.expectedStateTransitions);
      fixture.transcript.forEach((turn, index) => {
        expect(
          result.extractedInfoCodesByTurn[index],
          `${fixture.id}: turn ${index} did not parse the current item`,
        ).toContain(turn.currentInfoCode);
        if (turn.expectedExtractedInfoCodes) {
          expect(result.extractedInfoCodesByTurn[index]).toEqual(
            turn.expectedExtractedInfoCodes,
          );
        }
      });

      for (const expectedFeature of fixture.expectedFeatures) {
        const actual = result.features.features.find(
          (feature) => feature.name === expectedFeature.name,
        );
        expect(actual, `${fixture.id}:${expectedFeature.name}`).toBeDefined();
        expect(actual?.state).toBe(expectedFeature.state);
        if ("raw" in expectedFeature) expect(actual?.raw).toEqual(expectedFeature.raw);
        if ("normalized" in expectedFeature) {
          expect(actual?.normalized).toBe(expectedFeature.normalized);
        }
      }

      expect(result.goal).toMatchObject(fixture.expectedGoal);
      expect(result.finalSnapshotIssues).toEqual([]);
      expect(result.evaluation).toMatchObject({
        status: fixture.expectedEvaluation.status,
        gradeScope: fixture.expectedEvaluation.gradeScope,
        approvalDecision: fixture.expectedEvaluation.approvalDecision,
        overall: { grade: fixture.expectedEvaluation.overallGrade },
      });
      expect(result.evaluation.decisionScope).toBe(
        "INTERVIEW_DATA_QUALITY_ONLY",
      );

      if (fixture.boundaryTags.includes("conflict")) {
        expect(result.conflictsDetected).toBe(1);
        expect(result.conflictsResolved).toBe(1);
      } else {
        expect(result.conflictsDetected).toBe(0);
        expect(result.conflictsResolved).toBe(0);
      }
    });
  }

  it("contains conflict, refusal, ambiguity, range, zero and multi-collection boundaries", () => {
    const tags = new Set(
      SOHO_SCENARIO_FIXTURES.flatMap((fixture) => fixture.boundaryTags),
    );
    for (const required of [
      "conflict",
      "refused",
      "unknown",
      "range",
      "actual-zero",
      "multi-collection",
    ]) {
      expect(tags.has(required), required).toBe(true);
    }
  });
});
