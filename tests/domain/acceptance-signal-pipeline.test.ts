import { describe, expect, it } from "vitest";

import {
  DEV_V1_ALL_INFORMATION_CATALOG,
  assessInterviewCompletion,
  buildEvidenceLinkedSummary,
  calculateLiveFeatures,
  createCanonicalValueRevision,
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
  extractGoalSnapshot,
  featurePreviewDelta,
  planDeterministicInterviewTurn,
  selectCanonicalRevision,
  summaryPreviewDelta,
  validateImmutableFinalSnapshotV1,
  type CanonicalInformationRecord,
  type DeterministicTurnPlan,
  type EvidenceRef,
  type ImmutableFinalInterviewSnapshotV1,
  type InformationItem,
  type TranscriptSegment,
} from "../../src/domain";

const INTERVIEW_ID = "acceptance-restaurant";

function informationItems(): InformationItem[] {
  return createDevV1AcceptanceRequiredInformationItems().map((item, index) => ({
    ...item,
    priority: item.required ? item.priority : "P0",
    status: item.infoCode === "platform_fee_pressure" ? "ASKING" : "NEEDED",
    valueState: "MISSING",
    value: null,
    quality: null,
    extractionConfidence: null,
    verification: null,
    evidenceIds: [],
    prefill: null,
    updatedAt: `2026-08-10T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
}

function canonicalRecords(): CanonicalInformationRecord[] {
  return DEV_V1_ALL_INFORMATION_CATALOG.filter((definition) =>
    [
      "platform_fee_pressure",
      "hall_customer_decline",
      "repeat_customer_share",
      "improvement_plan",
    ].includes(definition.infoCode),
  ).map((definition, index) => ({
    infoCode: definition.infoCode,
    category: definition.category,
    required: definition.required,
    priority: definition.priority,
    minQuality: definition.minQuality,
    status: definition.infoCode === "platform_fee_pressure" ? "ASKING" : "NEEDED",
    valueState: "MISSING",
    selectedRevisionId: null,
    revisions: [],
    updatedAt: `2026-08-10T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
}

function applyTurn(input: {
  turnIndex: number;
  plan: DeterministicTurnPlan;
  items: InformationItem[];
  records: CanonicalInformationRecord[];
  evidence: EvidenceRef[];
  transcript: TranscriptSegment[];
}): { items: InformationItem[]; records: CanonicalInformationRecord[] } {
  const observedAt = `2026-08-10T00:0${input.turnIndex}:00.000Z`;
  const transcriptSegmentId = `transcript-${input.turnIndex}`;
  input.transcript.push({
    id: transcriptSegmentId,
    interviewId: INTERVIEW_ID,
    sequence: input.turnIndex,
    speaker: "BORROWER",
    text: input.plan.text,
    confirmation: "FINAL",
    createdAt: observedAt,
  });

  const finalStatusByCode = new Map(
    input.plan.stateChanges.map((transition) => [transition.infoCode, transition.to]),
  );
  let items = input.items.map((item) => ({
    ...item,
    status: finalStatusByCode.get(item.infoCode) ?? item.status,
  }));
  let records = input.records.map((record) => ({
    ...record,
    status: finalStatusByCode.get(record.infoCode) ?? record.status,
  }));

  for (const candidate of input.plan.extractedItems) {
    // A confirmed item may still share an anchor with a later turn. The runtime
    // intentionally persists only candidates that own an accepted state change.
    if (!input.plan.stateChanges.some((transition) => transition.infoCode === candidate.infoCode)) {
      continue;
    }
    const record = records.find((entry) => entry.infoCode === candidate.infoCode);
    if (!record) continue;
    const evidenceId = `evidence-${input.turnIndex}-${candidate.infoCode}`;
    const evidenceRef: EvidenceRef = {
      id: evidenceId,
      interviewId: INTERVIEW_ID,
      infoCode: candidate.infoCode,
      kind: candidate.verification,
      source: "borrower_statement",
      transcriptSegmentId,
      excerpt: candidate.evidenceSpan.text,
      observedAt,
      metadata: {
        parserConfidence: candidate.parserConfidence,
        missingFields: candidate.missingFields,
      },
    };
    input.evidence.push(evidenceRef);
    const revision = createCanonicalValueRevision(
      {
        id: `revision-${input.turnIndex}-${candidate.infoCode}`,
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
    const revisions = selectCanonicalRevision([...record.revisions, revision], revision.id);
    records = records.map((entry) =>
      entry.infoCode === candidate.infoCode
        ? {
            ...entry,
            status: candidate.proposedStatus,
            valueState: candidate.valueState,
            selectedRevisionId: revision.id,
            revisions,
            updatedAt: observedAt,
          }
        : entry,
    );
    items = items.map((item) =>
      item.infoCode === candidate.infoCode
        ? {
            ...item,
            status: candidate.proposedStatus,
            valueState: candidate.valueState,
            quality: candidate.quality,
            extractionConfidence: candidate.parserConfidence,
            verification: candidate.verification,
            evidenceIds: [...item.evidenceIds, evidenceId],
            updatedAt: observedAt,
          }
        : item,
    );
  }
  return { items, records };
}

describe("restaurant acceptance signal lineage", () => {
  it("preserves the eight-item contract while executing multi-extraction through FINAL lineage", () => {
    expect(createDevV1RequiredInformationItems()).toHaveLength(8);
    expect(createDevV1AcceptanceRequiredInformationItems()).toHaveLength(11);

    let items = informationItems();
    let records = canonicalRecords();
    const evidence: EvidenceRef[] = [];
    const transcript: TranscriptSegment[] = [];

    const first = planDeterministicInterviewTurn({
      text: "배달은 계속 나오는데 수수료가 많이 나가고 홀 손님이 줄었어요. 그래도 단골 매출은 절반 정도 됩니다.",
      currentInfoCode: "platform_fee_pressure",
      informationItems: items,
    });
    expect(first.extractedItems.map((candidate) => candidate.infoCode)).toEqual([
      "platform_fee_pressure",
      "hall_customer_decline",
      "repeat_customer_share",
    ]);
    expect(first.stateChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ infoCode: "platform_fee_pressure", to: "CONFIRMED" }),
        expect.objectContaining({ infoCode: "hall_customer_decline", to: "CONFIRMED" }),
        expect.objectContaining({ infoCode: "repeat_customer_share", to: "NEEDS_FOLLOWUP" }),
      ]),
    );
    expect(first.nextQuestion).toEqual({
      infoCode: "repeat_customer_share",
      text: "최근 한 달 기준으로 단골 매출은 몇 % 정도인가요?",
      reason: "FOLLOWUP",
    });
    ({ items, records } = applyTurn({
      turnIndex: 1,
      plan: first,
      items,
      records,
      evidence,
      transcript,
    }));
    const firstRepeat = records.find((record) => record.infoCode === "repeat_customer_share")!;
    expect(firstRepeat.revisions[0].value).toMatchObject({
      kind: "PERCENTAGE",
      percentage: { kind: "RANGE", min: 45, max: 55 },
      approximation: "SEMANTIC_RANGE",
    });
    const firstFeatures = calculateLiveFeatures({ records, stateVersion: 1 });
    expect(firstFeatures.features.find((feature) => feature.name === "repeat_customer_share")).toMatchObject({
      state: "COMPUTED",
      raw: { kind: "RANGE", min: 0.45, max: 0.55 },
    });
    expect(firstFeatures.features.find((feature) => feature.name === "shock_present")).toMatchObject({
      state: "COMPUTED",
      raw: true,
      normalized: 1,
    });

    const second = planDeterministicInterviewTurn({
      text: "45% 정도요.",
      currentInfoCode: "repeat_customer_share",
      informationItems: items,
    });
    expect(second.stateChanges).toEqual([
      expect.objectContaining({ from: "NEEDS_FOLLOWUP", to: "ASKING" }),
      expect.objectContaining({ from: "ASKING", to: "COLLECTED" }),
      expect.objectContaining({ from: "COLLECTED", to: "CONFIRMED" }),
    ]);
    expect(second.nextQuestion).toMatchObject({
      infoCode: "improvement_plan",
      reason: "PRIORITY",
    });
    ({ items, records } = applyTurn({
      turnIndex: 2,
      plan: second,
      items,
      records,
      evidence,
      transcript,
    }));
    const confirmedRepeat = records.find((record) => record.infoCode === "repeat_customer_share")!;
    expect(confirmedRepeat.revisions).toHaveLength(2);
    expect(confirmedRepeat.revisions.map((revision) => revision.status)).toEqual([
      "SUPERSEDED",
      "SELECTED",
    ]);
    expect(confirmedRepeat.revisions[1]).toMatchObject({
      supersedesRevisionId: "revision-1-repeat_customer_share",
      value: { kind: "PERCENTAGE", percentage: { kind: "EXACT", value: 45 } },
      evidenceIds: ["evidence-2-repeat_customer_share"],
    });
    const secondFeatures = calculateLiveFeatures({ records, stateVersion: 2 });
    expect(featurePreviewDelta(firstFeatures, secondFeatures)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "repeat_customer_share",
          raw: { kind: "EXACT", value: 0.45 },
          evidenceIds: ["evidence-2-repeat_customer_share"],
        }),
      ]),
    );

    items = items.map((item) =>
      item.infoCode === "improvement_plan" ? { ...item, status: "ASKING" } : item,
    );
    records = records.map((record) =>
      record.infoCode === "improvement_plan" ? { ...record, status: "ASKING" } : record,
    );
    const beforePlanSummary = buildEvidenceLinkedSummary({
      records,
      features: secondFeatures,
      version: 2,
      generatedAt: "2026-08-10T00:02:00.000Z",
    });
    const third = planDeterministicInterviewTurn({
      text: "단골들은 전화주문을 받고 싶어요. 지금 직접주문이 18%인데 두 달 안에 30%까지 늘리고 싶습니다.",
      currentInfoCode: "improvement_plan",
      informationItems: items,
    });
    const planCandidate = third.extractedItems.find(
      (candidate) => candidate.infoCode === "improvement_plan",
    )!;
    expect(planCandidate).toMatchObject({ proposedStatus: "CONFIRMED", missingFields: [] });
    expect(planCandidate.value).toMatchObject({
      kind: "IMPROVEMENT_PLAN",
      planExists: true,
      baseline: { value: { kind: "EXACT", value: 18 }, unit: "%" },
      target: { value: { kind: "EXACT", value: 30 }, unit: "%" },
      schedule: { duration: { kind: "EXACT", value: 8 }, unit: "WEEK" },
      measurementSources: ["PHONE_ORDER_LOG"],
      origin: "BORROWER_DIRECT",
    });
    expect(JSON.stringify(planCandidate.value)).not.toMatch(
      /sentiment|voice_confidence|facial_expression/i,
    );
    ({ items, records } = applyTurn({
      turnIndex: 3,
      plan: third,
      items,
      records,
      evidence,
      transcript,
    }));

    const finalFeatures = calculateLiveFeatures({
      records,
      stateVersion: 3,
      snapshotType: "FINAL",
    });
    expect(featurePreviewDelta(secondFeatures, finalFeatures)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "plan_measurability", raw: true, normalized: 1 }),
        expect.objectContaining({ name: "plan_specificity", normalized: 1 }),
      ]),
    );
    const goal = extractGoalSnapshot(records);
    expect(goal).toMatchObject({
      status: "CONFIRMED",
      numericStatus: "DIRECT",
      baseline: { value: { kind: "EXACT", value: 18 }, unit: "%" },
      target: { value: { kind: "EXACT", value: 30 }, unit: "%" },
      period: { value: 8, unit: "WEEK" },
      measurementSources: ["PHONE_ORDER_LOG"],
      evidenceIds: ["evidence-3-improvement_plan"],
    });
    const finalSummary = buildEvidenceLinkedSummary({
      records,
      features: finalFeatures,
      version: 3,
      generatedAt: "2026-08-10T00:03:00.000Z",
      snapshotType: "FINAL",
    });
    const immutableFinalFeatures = { ...finalFeatures, snapshotType: "FINAL" as const };
    const immutableFinalSummary = { ...finalSummary, snapshotType: "FINAL" as const };
    expect(finalSummary.plainText).toContain("반복고객 매출 비중은 45%");
    expect(finalSummary.plainText).toContain("배달 플랫폼 수수료");
    expect(finalSummary.plainText).toContain("직접주문이 18%");
    expect(summaryPreviewDelta(beforePlanSummary, finalSummary)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "BORROWER_IMPROVEMENT_PLAN" }),
      ]),
    );

    const completionAssessment = assessInterviewCompletion({
      mode: "FORCE_INCOMPLETE",
      records,
      featureSet: finalFeatures,
      goal,
      borrowerConfirmation: {
        status: "PENDING",
        confirmedAt: null,
        transcriptSegmentId: null,
        evidenceId: null,
      },
      knownEvidenceIds: new Set(evidence.map((item) => item.id)),
      catalogValid: true,
      activeTurn: false,
      finalTranscriptPending: false,
      unresolvedConflictInfoCodes: [],
      forceReason: "acceptance journey validates partial supporting signals",
    });
    const finalSnapshot: ImmutableFinalInterviewSnapshotV1 = {
      id: "final-acceptance",
      interviewId: INTERVIEW_ID,
      snapshotType: "FINAL",
      schemaVersion: "dev-v1",
      stateVersion: 3,
      finalizedAt: "2026-08-10T00:03:00.000Z",
      completionStatus: "INCOMPLETE",
      completionAssessment,
      borrower: { id: "borrower-acceptance", name: "김동행" },
      business: {
        id: "business-acceptance",
        borrowerId: "borrower-acceptance",
        businessName: "동행식당",
        industry: "음식점",
      },
      informationItems: records,
      features: immutableFinalFeatures,
      goalSnapshot: goal,
      borrowerSummary: immutableFinalSummary,
      transcript,
      evidenceManifest: evidence,
      versions: {
        valueSchema: "dev-v1",
        parser: "dev-v1",
        featureRegistry: "dev-v1",
        goalPolicy: "dev-v1",
        completionPolicy: "dev-v1",
        evaluationPolicy: "dev-v1",
      },
      contentHash: "sha256:acceptance-signal-lineage",
    };
    expect(validateImmutableFinalSnapshotV1(finalSnapshot)).toEqual([]);
    expect(finalSnapshot.features.snapshotType).toBe("FINAL");
    expect(finalSnapshot.transcript.every((segment) => segment.confirmation === "FINAL")).toBe(true);
    expect(
      finalSnapshot.evidenceManifest.every((ref) =>
        finalSnapshot.transcript.some((segment) => segment.id === ref.transcriptSegmentId),
      ),
    ).toBe(true);
  });
});
