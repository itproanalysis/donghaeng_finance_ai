import { describe, expect, it } from "vitest";

import {
  adaptEvaluation,
  adaptEvaluationList,
  adaptFinalSnapshot,
  adaptLiveSnapshot,
  ApiRequestError,
  diffLiveFeatureSnapshots,
  selectEvaluationPillarLineage,
  shouldClearPendingMessageRetry,
} from "../../src/components/api-adapter";

describe("API view adapters", () => {
  it("marks stale, busy, and conflict responses for retry-state clear and resync", () => {
    for (const code of [
      "MESSAGE_STAGE_STALE",
      "MESSAGE_STAGE_BUSY",
      "MESSAGE_STAGE_PENDING",
      "VERSION_CONFLICT",
    ]) {
      expect(
        shouldClearPendingMessageRetry(
          new ApiRequestError("safe message", [], code, 409),
        ),
      ).toBe(true);
    }
    expect(
      shouldClearPendingMessageRetry(
        new ApiRequestError("consent", [], "CLOUD_AI_PROCESSING_CONSENT_REQUIRED", 403),
      ),
    ).toBe(false);
  });

  it("shows only server-produced feature value changes without deriving a score", () => {
    const base = {
      domain: "CURRENT_STATE",
      sourceInfoCodes: [],
      evidenceIds: [],
      formula: null,
      reason: null,
    };
    expect(diffLiveFeatureSnapshots(
      [
        { ...base, name: "repeat_customer_share", state: "MISSING", raw: null, normalized: null },
        { ...base, name: "fixed_cost_ratio", state: "COMPUTED", raw: "40%", normalized: 0.4 },
      ],
      [
        { ...base, name: "repeat_customer_share", state: "COMPUTED", raw: "45%", normalized: 0.45 },
        { ...base, name: "fixed_cost_ratio", state: "COMPUTED", raw: "40%", normalized: 0.4 },
      ],
    )).toEqual([
      {
        name: "repeat_customer_share",
        previousState: "MISSING",
        currentState: "COMPUTED",
        previousRaw: null,
        currentRaw: "45%",
        previousNormalized: null,
        currentNormalized: 0.45,
      },
    ]);
  });

  it("adapts the tenant evaluation list without conflating information coverage and quality score", () => {
    const list = adaptEvaluationList({
      items: [
        {
          id: "evaluation-1",
          interviewId: "interview-1",
          status: "READY",
          createdAt: "2026-08-10T01:00:00.000Z",
          completedAt: "2026-08-10T01:05:00.000Z",
          borrowerName: "김동행",
          businessName: "동행식당",
          industry: "한식 음식점",
          overallScore: 82,
          overallLevel: "B",
          overallLevelLabel: "B · 데이터 품질",
          informationRate: 94,
          goalCount: 2,
          completionStatus: "COMPLETE",
        },
        {
          id: "evaluation-2",
          interviewId: "interview-2",
          business: { industry: "온라인판매" },
          overall: {
            score: 0.71,
            level: "C",
            completionStatus: "COMPLETE",
          },
        },
      ],
      total: 2,
      facets: { industries: ["한식 음식점", "온라인판매"], levels: ["B", "C"] },
    });

    expect(list.total).toBe(2);
    expect(list.facets).toEqual({
      industries: ["한식 음식점", "온라인판매"],
      levels: ["B", "C"],
    });
    expect(list.items[0]).toMatchObject({
      borrowerName: "김동행",
      overallScore: 82,
      informationRate: 94,
      goalCount: 2,
      completedAt: "2026-08-10T01:05:00.000Z",
    });
    expect(list.items[1]).toMatchObject({
      overallScore: 71,
      informationRate: null,
      overallLevel: "C",
    });
  });

  it("keeps server PREVIEW features and pins the current ASKING item first", () => {
    const live = adaptLiveSnapshot({
      session: {
        id: "interview-feature",
        lifecycleStatus: "ACTIVE",
        version: 4,
        lastEventSeq: 9,
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
      borrower: { name: "김동행" },
      business: { businessName: "동행상점", industry: "소매" },
      informationItems: [
        {
          infoCode: "fixed_operating_costs",
          category: "CURRENT_STATE",
          priority: "P0",
          status: "NEEDED",
          valueState: "MISSING",
        },
        {
          infoCode: "monthly_average_sales",
          category: "CURRENT_STATE",
          priority: "P0",
          status: "ASKING",
          valueState: "MISSING",
        },
        {
          infoCode: "repeat_customer_share",
          category: "CURRENT_STATE",
          priority: "P0",
          status: "CONFIRMED",
          valueState: "PRESENT",
          value: {
            kind: "PERCENTAGE",
            percentage: { kind: "EXACT", value: 45 },
          },
        },
        {
          infoCode: "platform_fee_pressure",
          category: "CURRENT_STATE",
          priority: "P0",
          status: "CONFIRMED",
          valueState: "PRESENT",
          value: {
            kind: "BUSINESS_SIGNAL",
            signal: "PLATFORM_FEE_PRESSURE",
            observed: true,
          },
        },
      ],
      transcript: [],
      evidence: [],
      coverage: { byCategory: {} },
      nextQuestion: {
        infoCode: "monthly_average_sales",
        text: "월평균 매출은 얼마인가요?",
        reason: "P0",
      },
      features: {
        snapshotType: "PREVIEW",
        stateVersion: 4,
        registryVersion: "dev-v1",
        features: [
          {
            name: "fixed_cost_ratio",
            domain: "CURRENT_STATE",
            state: "COMPUTED",
            raw: { kind: "EXACT", value: 0.4 },
            normalized: null,
            sourceInfoCodes: ["monthly_average_sales", "fixed_operating_costs"],
            evidenceIds: ["evidence-1"],
            formula: "fixed_operating_costs / monthly_average_sales",
            reason: "동일 월 기준 비율입니다.",
          },
          {
            name: "plan_specificity",
            domain: "IMPROVEMENT_INTENT",
            state: "COMPUTED",
            raw: {
              level: 4,
              reason: "근거가 있는 계획입니다.",
              evidenceIds: ["internal-evidence-id"],
            },
            normalized: 0.8,
            sourceInfoCodes: ["improvement_plan"],
            evidenceIds: ["internal-evidence-id"],
            formula: "rubric_level / 5",
            reason: "서버 정규화 결과입니다.",
          },
          {
            name: "demand_visibility",
            domain: "FUTURE_OUTLOOK",
            state: "COMPUTED",
            raw: {
              confirmedReservations: { kind: "EXACT", value: 3 },
              bases: [{ kind: "HISTORICAL" }, { kind: "RESERVATION" }],
            },
            normalized: null,
            sourceInfoCodes: ["confirmed_reservations", "seasonality_outlook"],
            evidenceIds: ["evidence-2"],
            formula: null,
            reason: "확정수요 근거입니다.",
          },
          {
            name: "repeat_customer_share",
            domain: "CURRENT_STATE",
            state: "COMPUTED",
            raw: { kind: "EXACT", value: 0.45 },
            normalized: null,
            sourceInfoCodes: ["repeat_customer_share"],
            evidenceIds: ["evidence-repeat"],
            formula: "repeat_customer_percentage / 100",
            reason: "비율 단위 변환입니다.",
          },
        ],
      },
      liveSummary: null,
      pendingCommand: {
        text: "월 고정 운영비는 900만원입니다.",
        clientMessageId: "message-retry-1",
        expectedVersion: 4,
        currentQuestionInfoCode: "monthly_average_sales",
        transcriptMetadata: {
          startMs: 100,
          endMs: 900,
          sttConfidence: 0.91,
          sttProvider: "local-stt",
        },
        processingState: "READY",
        requestHash: "must-not-be-exposed",
        leaseToken: "must-not-be-exposed",
      },
    });

    expect(live.buckets.needed.map((item) => item.infoCode)).toEqual([
      "monthly_average_sales",
      "fixed_operating_costs",
    ]);
    expect(live.featureRegistryVersion).toBe("dev-v1");
    expect(live.featureStateVersion).toBe(4);
    expect(live.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "fixed_cost_ratio",
          state: "COMPUTED",
          raw: "0.4",
          formula: "fixed_operating_costs / monthly_average_sales",
        }),
        expect.objectContaining({ name: "plan_specificity", raw: "4 / 5" }),
        expect.objectContaining({ name: "repeat_customer_share", raw: "45%" }),
        expect.objectContaining({
          name: "demand_visibility",
          raw: "확정수요 3건 · 근거 2개",
        }),
      ]),
    );
    expect(live.features.map((feature) => feature.raw).join(" ")).not.toContain(
      "internal-evidence-id",
    );
    expect(live.pendingCommand).toEqual({
      text: "월 고정 운영비는 900만원입니다.",
      clientMessageId: "message-retry-1",
      expectedVersion: 4,
      currentQuestionInfoCode: "monthly_average_sales",
      transcriptMetadata: {
        startMs: 100,
        endMs: 900,
        sttConfidence: 0.91,
        sttProvider: "local-stt",
      },
      processingState: "READY",
    });
    expect(JSON.stringify(live.pendingCommand)).not.toContain("must-not-be-exposed");
    expect(live.buckets.completed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ infoCode: "repeat_customer_share", displayValue: "45%" }),
        expect.objectContaining({
          infoCode: "platform_fee_pressure",
          displayValue: "플랫폼 비용부담 확인",
        }),
      ]),
    );
  });

  it("reads evidence-linked PREVIEW and FINAL summaries", () => {
    const live = adaptLiveSnapshot({
      session: {
        id: "interview-1",
        lifecycleStatus: "ACTIVE",
        version: 3,
        lastEventSeq: 8,
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
      borrower: { name: "김동행" },
      business: { businessName: "동행상점", industry: "소매" },
      informationItems: [],
      transcript: [],
      evidence: [],
      coverage: { byCategory: {} },
      nextQuestion: null,
      liveSummary: { plainText: "근거가 연결된 PREVIEW 요약입니다." },
    });
    expect(live.liveSummary).toBe("근거가 연결된 PREVIEW 요약입니다.");

    const final = adaptFinalSnapshot({
      id: "final-1",
      interviewId: "interview-1",
      snapshotType: "FINAL",
      stateVersion: 9,
      completionStatus: "COMPLETE",
      finalizedAt: "2026-08-10T01:00:00.000Z",
      borrower: { name: "김동행" },
      business: { businessName: "동행상점", industry: "소매" },
      informationItems: [],
      evidenceManifest: [],
      coverage: {},
      borrowerSummary: { plainText: "근거가 연결된 FINAL 요약입니다." },
      session: { id: "interview-1", snapshotType: "FINAL", lastEventSeq: 12 },
    });
    expect(final.version).toBe(9);
    expect(final.transcriptSummary).toBe("근거가 연결된 FINAL 요약입니다.");
  });

  it("adapts the dev-v1 data-quality evaluation without legacy fields", () => {
    const evaluation = adaptEvaluation(
      {
        id: "evaluation-1",
        interviewId: "interview-1",
        finalSnapshotId: "final-1",
        snapshotVersion: 9,
        status: "READY",
        decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
        gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
        disclaimer: "승인 판단이 아닙니다.",
        createdAt: "2026-08-10T01:00:00.000Z",
        overall: { score: 87, grade: "B", completionStatus: "COMPLETE" },
        pillars: [
          {
            category: "CURRENT_STATE",
            score: 75,
            grade: "C",
            evaluableItems: 2,
            totalRequiredItems: 3,
            computedFeatures: 2,
            totalRequiredFeatures: 2,
            summary: "현재 상황 데이터 품질 요약",
            featureNames: [
              "monthly_sales",
              "past_execution_examples",
              "feature-missing-from-snapshot",
            ],
            evidenceIds: ["evidence-1", "evidence-missing-from-snapshot"],
          },
        ],
        items: [
          {
            infoCode: "monthly_average_sales",
            score: 82,
            grade: "B",
            source: "borrower_statement",
            asOf: "2026-08-10T00:59:00.000Z",
            summary: "추출 신뢰도와 자기진술 근거를 반영한 인터뷰 데이터 품질입니다.",
          },
          {
            infoCode: "fixed_operating_costs",
            score: null,
            grade: "UNGRADED",
            source: null,
            asOf: null,
            summary: "근거가 미확인되어 등급을 산출하지 않았습니다.",
          },
        ],
        failureReasons: [],
      },
      {
        borrower: { name: "김동행" },
        business: { businessName: "동행상점", industry: "소매" },
        goalSnapshot: {
          status: "CONFIRMED",
          numericStatus: "DIRECT",
          title: "재고 비용 절감",
          baseline: { value: { kind: "EXACT", value: 1_000_000 }, unit: "KRW" },
          target: { value: { kind: "EXACT", value: 500_000 }, unit: "KRW" },
          period: { value: 3, unit: "MONTH" },
          unit: "KRW",
          measurementSources: ["INVENTORY_LEDGER"],
          origin: "BORROWER_STATED",
          context: "장기 재고 비용",
          behaviorEvent: {
            eventName: "goal_measurement:INVENTORY_LEDGER",
            window: "3 MONTH",
            metric: "KRW",
            aggregation: "SUM",
            source: "INVENTORY_LEDGER",
          },
          evidenceIds: ["evidence-1"],
        },
        informationItems: [
          {
            infoCode: "monthly_average_sales",
            category: "CURRENT_STATE",
            priority: "P0",
            status: "CONFIRMED",
            valueState: "PRESENT",
            selectedRevisionId: null,
            revisions: [],
            evidenceIds: ["evidence-1"],
          },
          {
            infoCode: "fixed_operating_costs",
            category: "CURRENT_STATE",
            priority: "P0",
            status: "NEEDS_FOLLOWUP",
            valueState: "PRESENT",
            selectedRevisionId: null,
            revisions: [],
          },
          {
            infoCode: "current_state_optional_note",
            category: "CURRENT_STATE",
            priority: "P2",
            required: false,
            status: "CONFIRMED",
            valueState: "PRESENT",
            selectedRevisionId: null,
            revisions: [],
            evidenceIds: ["evidence-2"],
          },
        ],
        evidenceManifest: [
          {
            id: "evidence-1",
            infoCode: "monthly_average_sales",
            kind: "SELF_REPORTED",
            source: "borrower_statement",
            transcriptSegmentId: "transcript-1",
            excerpt: "월평균 매출은 2,500만원입니다.",
            observedAt: "2026-08-10T00:59:00.000Z",
          },
          {
            id: "evidence-2",
            infoCode: "current_state_optional_note",
            kind: "SELF_REPORTED",
            source: "borrower_statement",
            transcriptSegmentId: null,
            excerpt: "추가 참고 진술",
            observedAt: "2026-08-10T00:59:30.000Z",
          },
        ],
        transcript: [
          {
            id: "transcript-1",
            speaker: "BORROWER",
            text: "월평균 매출은 2,500만원입니다.",
            rawText: "월평균 매출은 이천오백입니다.",
            correctedText: "월평균 매출은 2,500만원입니다.",
            revision: 2,
            startMs: 1_200,
            endMs: 4_800,
            sttConfidence: 0.93,
            sttProvider: "mock-stt",
            createdAt: "2026-08-10T00:59:00.000Z",
          },
        ],
        borrowerSummary: { plainText: "확정 요약" },
        features: {
          features: [
            {
              name: "monthly_sales",
              domain: "CURRENT_STATE",
              state: "COMPUTED",
              raw: { kind: "EXACT", value: 25_000_000, unit: "KRW" },
              normalized: 25_000_000,
              sourceInfoCodes: ["monthly_average_sales"],
              evidenceIds: ["evidence-1"],
              formula: "monthly_average_sales",
              reason: null,
            },
            {
              name: "past_execution_examples",
              domain: "CURRENT_STATE",
              state: "MISSING",
              raw: null,
              normalized: null,
              sourceInfoCodes: ["past_execution_examples"],
              evidenceIds: [],
              formula: null,
              reason: "입력 부족",
            },
            {
              name: "optional_context_feature",
              domain: "CURRENT_STATE",
              state: "COMPUTED",
              raw: "추가 참고 진술",
              normalized: null,
              sourceInfoCodes: ["current_state_optional_note"],
              evidenceIds: ["evidence-2"],
              formula: null,
              reason: "참고 전용",
            },
          ],
        },
      },
    );

    expect(evaluation.overallScore).toBe(87);
    expect(evaluation.overallLevel).toBe("B");
    expect(evaluation.overallLevelLabel).toContain("데이터 품질");
    expect(evaluation.pillars[0]).toMatchObject({
      key: "CURRENT_STATE",
      score: 75,
      level: "C",
      total: 3,
      resolved: 2,
      contributingFeatureNames: [
        "monthly_sales",
        "past_execution_examples",
        "feature-missing-from-snapshot",
      ],
      contributingEvidenceIds: ["evidence-1", "evidence-missing-from-snapshot"],
    });
    expect(evaluation.unresolvedItems).toEqual([
      expect.objectContaining({ infoCode: "fixed_operating_costs" }),
    ]);
    expect(evaluation.sourceInformation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          infoCode: "monthly_average_sales",
          dataQualityScore: 82,
          dataQualityGrade: "B",
          dataQualitySource: "borrower_statement",
          dataQualityAsOf: "2026-08-10T00:59:00.000Z",
        }),
        expect.objectContaining({
          infoCode: "fixed_operating_costs",
          dataQualityScore: null,
          dataQualityGrade: "UNGRADED",
          dataQualitySource: null,
          dataQualityAsOf: null,
        }),
      ]),
    );
    expect(evaluation.evidence[0]).toMatchObject({
      transcriptSegmentId: "transcript-1",
      linkedTranscript: {
        id: "transcript-1",
        rawText: "월평균 매출은 이천오백입니다.",
        correctedText: "월평균 매출은 2,500만원입니다.",
        text: "월평균 매출은 2,500만원입니다.",
        revision: 2,
        startMs: 1_200,
        endMs: 4_800,
        sttConfidence: 0.93,
        sttProvider: "mock-stt",
      },
    });
    const lineage = selectEvaluationPillarLineage(evaluation, evaluation.pillars[0]);
    expect(lineage.contributingFeatures.map((feature) => feature.name)).toEqual([
      "monthly_sales",
      "past_execution_examples",
    ]);
    expect(lineage.referenceFeatures.map((feature) => feature.name)).toEqual([
      "optional_context_feature",
    ]);
    expect(lineage.missingContributingFeatureNames).toEqual([
      "feature-missing-from-snapshot",
    ]);
    expect(lineage.contributingInformation.map((item) => item.infoCode)).toEqual([
      "monthly_average_sales",
      "fixed_operating_costs",
    ]);
    expect(lineage.referenceInformation.map((item) => item.infoCode)).toEqual([
      "current_state_optional_note",
    ]);
    expect(lineage.contributingEvidence).toEqual([
      expect.objectContaining({
        id: "evidence-1",
        linkedTranscript: expect.objectContaining({ id: "transcript-1" }),
      }),
    ]);
    expect(lineage.referenceEvidence.map((evidence) => evidence.id)).toEqual(["evidence-2"]);
    expect(lineage.missingContributingEvidenceIds).toEqual([
      "evidence-missing-from-snapshot",
    ]);
    expect(evaluation.goal).toMatchObject({
      unit: "KRW",
      measurementSource: "INVENTORY_LEDGER",
      behaviorEvent: {
        eventName: "goal_measurement:INVENTORY_LEDGER",
        window: "3개월",
        metric: "KRW",
        aggregation: "SUM",
        source: "INVENTORY_LEDGER",
      },
    });
  });
});
