import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

const ANSWERS: Record<string, string> = {
  monthly_average_sales: "카드 매출 월평균은 2,300만원입니다",
  fixed_operating_costs: "고정비는 월 1,000만원입니다",
  improvement_plan:
    "개선 계획은 폐기 비용이 문제입니다. 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
  execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
  confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
  seasonality_outlook: "계절성 전망은 작년보다 수요가 10% 증가할 것으로 봅니다",
  essential_household_expenses: "필수 가계지출은 월 300만원입니다",
  emergency_buffer_months: "비상자금은 4개월입니다",
};

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("full dev-v1 server pipeline", () => {
  it("collects all eight items and builds one immutable eligible FINAL", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `full-flow-${++id}`,
    });
    const created = service.createInterview(principal);
    let snapshot = created;
    const asked: string[] = [];

    for (let turn = 0; turn < 8; turn += 1) {
      const infoCode = snapshot.nextQuestion?.infoCode;
      if (!infoCode) throw new Error(`turn ${turn + 1}에 질문이 없습니다.`);
      const answer = ANSWERS[infoCode];
      if (!answer) throw new Error(`fixture 답변이 없습니다: ${infoCode}`);
      asked.push(infoCode);
      const result = service.addMessageCommand(
        created.session.id,
        {
          text: answer,
          clientMessageId: `full-message-${turn + 1}`,
          expectedVersion: snapshot.session.version,
          currentQuestionInfoCode: infoCode,
        },
        principal,
      );
      snapshot = result.snapshot;
    }

    expect(new Set(asked)).toEqual(new Set(Object.keys(ANSWERS)));
    expect(snapshot.nextQuestion).toBeNull();
    expect(snapshot.canonicalInformationItems).toHaveLength(8);
    expect(
      snapshot.canonicalInformationItems.every((record) => record.status === "CONFIRMED"),
    ).toBe(true);
    expect(snapshot.features.features.find((feature) => feature.name === "fixed_cost_ratio")).toMatchObject({
      state: "COMPUTED",
      formula: "fixed_operating_costs / monthly_average_sales",
    });
    expect(snapshot.improvementFeatures).toMatchObject({
      schemaVersion: "feature_schema_v2",
      enabled: true,
      features: expect.arrayContaining([
        expect.objectContaining({ name: "fin_sales_avg_3m", state: "COMPUTED", value: 23_000_000 }),
        expect.objectContaining({ name: "imp_plan_specificity", state: "COMPUTED" }),
      ]),
    });
    expect(snapshot.goalSnapshot).toMatchObject({ status: "CONFIRMED", numericStatus: "DIRECT" });

    const completed = service.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "full-complete",
        expectedVersion: snapshot.session.version,
        mode: "COMPLETE",
        borrowerConfirmed: true,
        reason: null,
      },
      principal,
    );

    expect(completed.evaluationEligibility).toEqual({
      eligible: true,
      blockers: [],
      mode: "COMPLETE",
      reason: null,
    });
    expect(completed.snapshot).toMatchObject({
      snapshotType: "FINAL",
      schemaVersion: "dev-v1",
      completionStatus: "COMPLETE",
      evaluationId: completed.evaluation?.id,
      session: { snapshotType: "FINAL", lifecycleStatus: "COMPLETE" },
      completionAssessment: { evaluationEligible: true, blockers: [] },
    });
    expect("features" in completed.snapshot && completed.snapshot.features.snapshotType).toBe("FINAL");
    expect(completed.snapshot.improvementFeatures).toMatchObject({
      schemaVersion: "feature_schema_v2",
      enabled: true,
    });
    expect(completed.evaluation).toMatchObject({
      status: "READY",
      decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
      approvalDecision: null,
      creditGrade: null,
    });
    const completionEvents = service.getRealtimeEvents(
      principal,
      created.session.id,
      snapshot.session.lastEventSeq,
    );
    expect(completionEvents.map((event) => event.type)).toEqual([
      "evaluation.ready",
      "interview.completed",
    ]);
    expect(completionEvents[0]).toMatchObject({
      snapshotType: "FINAL",
      isBatchFinal: false,
      data: {
        evaluationId: completed.evaluation?.id,
        decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
      },
    });
    expect(completionEvents[1]).toMatchObject({
      snapshotType: "FINAL",
      isBatchFinal: true,
    });
    expect(service.getInterviewSnapshot(created.session.id, principal)).toMatchObject({
      snapshotType: "FINAL",
      evaluationId: completed.evaluation?.id,
      improvementFeatures: { schemaVersion: "feature_schema_v2" },
    });
    expect(service.getFeaturesForPrincipal(created.session.id, principal)).toMatchObject({
      improvementFeatures: { schemaVersion: "feature_schema_v2" },
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM final_snapshots").get()?.count).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM evaluations").get()?.count).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM evaluation_pillars").get()?.count).toBe(4);
    expect(database.prepare("SELECT COUNT(*) AS count FROM evaluation_items").get()?.count).toBe(8);
    const persistedItem = database
      .prepare(
        `SELECT result_json, evidence_ids_json
         FROM evaluation_items
         WHERE item_code = 'monthly_average_sales'`,
      )
      .get();
    expect(JSON.parse(String(persistedItem?.result_json))).toMatchObject({
      infoCode: "monthly_average_sales",
      score: expect.any(Number),
      grade: expect.stringMatching(/^[A-E]$/),
      source: expect.any(String),
      asOf: expect.any(String),
    });
    expect(JSON.parse(String(persistedItem?.evidence_ids_json))).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(database.prepare("SELECT COUNT(*) AS count FROM evaluation_goals").get()?.count).toBe(1);
    expect(
      service.getEvaluationPillarsForPrincipal(created.session.id, principal),
    ).toMatchObject({
      snapshotType: "FINAL",
      pillars: expect.arrayContaining([
        expect.objectContaining({ category: "CURRENT_STATE" }),
      ]),
    });
    expect(
      service.getEvaluationGoalsForPrincipal(created.session.id, principal),
    ).toMatchObject({
      snapshotType: "FINAL",
      goals: [expect.objectContaining({ status: "CONFIRMED" })],
    });
    expect(
      service.getEvaluationEvidenceForPrincipal(created.session.id, principal),
    ).toMatchObject({
      snapshotType: "FINAL",
      evidence: expect.arrayContaining([
        expect.objectContaining({ transcriptSegmentId: expect.any(String) }),
      ]),
    });
    expect(() =>
      service.getEvaluationPillarsForPrincipal(created.session.id, {
        ...principal,
        tenantId: "not-the-owner-tenant",
      }),
    ).toThrow(/찾을 수 없습니다/);
    expect(() => database.prepare("UPDATE final_snapshots SET version = 99").run()).toThrow(
      /immutable/i,
    );
  });
});
